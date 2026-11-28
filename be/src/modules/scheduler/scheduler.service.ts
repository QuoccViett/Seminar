import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AuditService } from "../../common/services/audit.service.js";
import { lockPeriod } from "../../common/services/period-lock.js";
import { EvaluationStateService } from "../evaluations/evaluation-state.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { isDeadlineReminderDue } from "../../common/services/deadline-calculator.js";

/** Hiển thị snapshot thời gian UTC theo giờ Việt Nam để thông báo nêu rõ cửa sổ đã lưu
 * start và deadline là hai đầu cửa sổ loại trừ, không suy ra deadline từ số giờ legacy
 */
function displayWindow(start: Date, deadline: Date): string {
  const formatter = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
  return `từ ${formatter.format(start)} đến trước ${formatter.format(deadline)} theo giờ Việt Nam`;
}

/** Quét snapshot đã lưu và ghi sự kiện cùng transaction, không phụ thuộc giờ trình duyệt
 * Khóa kỳ trước hồ sơ tương thích với luồng lưu điểm, mỗi kỳ lỗi được thử lại độc lập
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EvaluationStateService) private readonly state: EvaluationStateService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** Khởi chạy ngay sau restart rồi quét định kỳ, cho phép nhiều tiến trình cùng chạy an toàn
   * Nếu một lượt chưa kết thúc thì bỏ nhịp chồng lấn trong tiến trình hiện tại
   */
  onModuleInit(): void {
    void this.run();
    this.timer = setInterval(() => { void this.run(); }, 60_000);
    this.timer.unref?.();
  }

  /** Dừng bộ đếm khi Nest đóng, transaction đang chạy vẫn được DB hoàn tất hoặc rollback */
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** Tìm các kỳ còn có thể phát sinh công việc, mỗi kỳ thất bại không chặn kỳ tiếp theo
   * Danh sách chỉ là gợi ý, mọi điều kiện và giờ được kiểm lại sau khi khóa trong xử lý kỳ
   */
  async run(): Promise<{ processed: number; failed: number; busy: boolean }> {
    if (this.running) return { processed: 0, failed: 0, busy: true };
    this.running = true;
    let processed = 0;
    let failed = 0;
    try {
      // Chỉ xóa token đã hết hạn, giữ token bị thu hồi còn hạn để phát hiện dùng lại
      // Hai phép dọn độc lập được thử lại ở nhịp sau nếu DB tạm thời gián đoạn
      const now = new Date();
      try { await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lte: now } } }); }
      catch { failed += 1; this.logger.error("Không thể dọn phiên đăng nhập hết hạn, hệ thống sẽ thử lại"); }
      try { await this.prisma.onboardingToken.deleteMany({ where: { expiresAt: { lte: now } } }); }
      catch { failed += 1; this.logger.error("Không thể dọn liên kết đăng ký hết hạn, hệ thống sẽ thử lại"); }
      const periods = await this.prisma.evaluationPeriod.findMany({
        where: { publishedAt: { not: null }, OR: [{ phase: { in: ["SETUP", "SELF_EVAL"] } }, { evaluations: { some: { status: "SUPPLEMENT_REQUESTED" } } }] },
        select: { id: true }, orderBy: { id: "asc" },
      });
      for (const period of periods) {
        try { await this.processPeriod(period.id); processed += 1; }
        catch { failed += 1; this.logger.error("Không thể xử lý lịch của một kỳ đánh giá, hệ thống sẽ thử lại"); }
      }
    } catch { failed += 1; this.logger.error("Không thể quét lịch kỳ đánh giá, hệ thống sẽ thử lại"); }
    finally { this.running = false; }
    return { processed, failed, busy: false };
  }

  /** Xử lý một kỳ bằng khóa hàng trên cùng connection với toàn bộ ghi nghiệp vụ
   * Giờ DB lấy sau khi chờ khóa, cửa sổ loại trừ deadline và không mở muộn sau hạn
   * Snapshot bổ sung chỉ đọc các mốc đã lưu, trạng thái đã nộp hoặc chốt không bị sửa
   */
  async processPeriod(periodId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockPeriod(tx, periodId);
      const period = await tx.evaluationPeriod.findUnique({ where: { id: periodId } });
      if (!period?.publishedAt) return;
      await tx.$queryRaw`SELECT id FROM evaluations WHERE period_id = ${periodId}::uuid ORDER BY id FOR UPDATE`;
      const evaluations = await tx.evaluation.findMany({ where: { periodId }, orderBy: { id: "asc" } });
      const now = await this.state.databaseNow(tx);
      const users = await tx.user.findMany({ where: { isActive: true, OR: [{ role: "ADMIN" }, { role: "UNIT", unitId: { in: evaluations.map((item) => item.unitId) } }] }, select: { id: true, role: true, unitId: true } });

      // Kỳ đã qua hạn được khóa trực tiếp, kể cả khi tiến trình bỏ lỡ toàn bộ cửa sổ mở
      if (period.selfEvalStart && period.selfEvalDeadline && period.selfEvalStart < period.selfEvalDeadline && ["SETUP", "SELF_EVAL"].includes(period.phase)) {
        const target = now >= period.selfEvalDeadline ? "FIRST_REVIEW" : now >= period.selfEvalStart && period.phase === "SETUP" ? "SELF_EVAL" : null;
        if (target) {
          if (target === "FIRST_REVIEW") for (const evaluation of evaluations) await this.state.reconcileInitial(tx, evaluation, period, now);
          await tx.evaluationPeriod.update({ where: { id: periodId }, data: { phase: target, updatedAt: now } });
          await this.audit.record({ actorId: null, action: "TRANSITION_PHASE", entity: "EvaluationPeriod", entityId: periodId, before: { phase: period.phase }, after: { phase: target } }, tx);
          for (const user of users) await this.notifications.notifyUser(tx, {
            userId: user.id, type: "PERIOD_PHASE_CHANGED", title: target === "SELF_EVAL" ? "Kỳ tự chấm đã mở" : "Kỳ tự chấm đã kết thúc",
            body: target === "SELF_EVAL" ? `Kỳ ${period.name} đã mở tự chấm ${displayWindow(period.selfEvalStart, period.selfEvalDeadline)}` : `Kỳ ${period.name} đã kết thúc tự chấm ${displayWindow(period.selfEvalStart, period.selfEvalDeadline)} và chuyển sang thẩm định lần đầu`,
            dedupeKey: `PERIOD_PHASE_CHANGED:${periodId}:${target}`, refType: "EVALUATION_PERIOD", refId: periodId,
            ...(target === "SELF_EVAL" ? { expiresAt: period.selfEvalDeadline } : {}),
          });
        }
      }

      // Chỉ chuyển yêu cầu còn chờ đã đến deadline, ghi lịch sử và thông báo đúng một lần
      for (const evaluation of evaluations) {
        if (evaluation.status !== "SUPPLEMENT_REQUESTED" || !evaluation.supplementDeadline || now < evaluation.supplementDeadline) continue;
        await this.state.reconcileSupplement(tx, evaluation, period, now);
      }

      // Quét bù từ nửa thời lượng mở (tối đa 24 giờ trước hạn) tới trước deadline
      // Dedupe theo hạn và TTL delivery tránh tạo trùng hoặc bắt đầu gửi sau hạn
      for (const evaluation of evaluations) {
        const initial = evaluation.status === "DRAFT" && ["SETUP", "SELF_EVAL"].includes(period.phase);
        const supplement = evaluation.status === "SUPPLEMENT_REQUESTED";
        const start = initial ? period.selfEvalStart : supplement ? evaluation.supplementStartAt : null;
        const deadline = initial ? period.selfEvalDeadline : supplement ? evaluation.supplementDeadline : null;
        if (!start || !deadline || !isDeadlineReminderDue(start, deadline, now)) continue;
        const recipient = users.find((item) => item.role === "UNIT" && item.unitId === evaluation.unitId);
        if (!recipient) continue;
        await this.notifications.notifyUser(tx, {
          userId: recipient.id, type: initial ? "SELF_EVAL_REMINDER" : "SUPPLEMENT_REMINDER", title: "Nhắc thời hạn hồ sơ",
          body: `Hồ sơ kỳ ${period.name} có thời gian ${displayWindow(start, deadline)}`,
          dedupeKey: `REMINDER:${evaluation.id}:${initial ? "INITIAL" : "SUPPLEMENT"}:${deadline.toISOString()}`,
          refType: "EVALUATION", refId: evaluation.id, expiresAt: deadline,
        });
      }
    }, { timeout: 30_000, maxWait: 10_000 });
  }
}
