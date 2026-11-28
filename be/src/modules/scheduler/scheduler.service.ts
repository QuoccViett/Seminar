import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
    @Optional() @Inject(ConfigService) private readonly config?: ConfigService,
  ) {}

  /** Khởi chạy ngay sau restart rồi quét định kỳ, cho phép nhiều tiến trình cùng chạy an toàn
   * Nếu một lượt chưa kết thúc thì bỏ nhịp chồng lấn trong tiến trình hiện tại
   */
  onModuleInit(): void {
    if (this.config?.get<boolean>("BACKGROUND_JOBS_ENABLED") === false) return;
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
        where: { publishedAt: { not: null }, OR: [{ phase: { in: ["SETUP", "SELF_EVAL"] } }, { evaluations: { some: { status: { in: ["DRAFT", "SUPPLEMENT_REQUESTED"] } } } }] },
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

  /** Đổi phase và reconcile theo các transaction ngắn, thứ tự khóa kỳ trước hồ sơ.
   * Mỗi lô lấy giờ DB sau khóa; outbox commit cùng trạng thái để restart có thể chạy tiếp.
   * Snapshot bổ sung chỉ đọc mốc đã lưu, trạng thái đã nộp hoặc chốt không bị sửa.
   */
  async processPeriod(periodId: string): Promise<void> {
    // Transaction độc quyền chỉ đổi phase và ghi công việc fanout bền vững.
    await this.prisma.$transaction(async (tx) => {
      await lockPeriod(tx, periodId);
      const period = await tx.evaluationPeriod.findUnique({ where: { id: periodId } });
      if (!period?.publishedAt) return;
      const now = await this.state.databaseNow(tx);
      if (period.selfEvalStart && period.selfEvalDeadline && period.selfEvalStart < period.selfEvalDeadline && ["SETUP", "SELF_EVAL"].includes(period.phase)) {
        const target = now >= period.selfEvalDeadline ? "FIRST_REVIEW" : now >= period.selfEvalStart && period.phase === "SETUP" ? "SELF_EVAL" : null;
        if (target) {
          const start = period.selfEvalStart;
          const deadline = period.selfEvalDeadline;
          await tx.evaluationPeriod.update({ where: { id: periodId }, data: { phase: target, updatedAt: now } });
          await this.audit.record({ actorId: null, action: "TRANSITION_PHASE", entity: "EvaluationPeriod", entityId: periodId, before: { phase: period.phase }, after: { phase: target } }, tx);
          const users = await tx.user.findMany({ where: { isActive: true, OR: [{ role: "ADMIN" }, { role: "UNIT", unit: { evaluations: { some: { periodId } } } }] }, select: { id: true } });
          await this.notifications.enqueueMany(tx, users.map((user) => ({
            userId: user.id, type: "PERIOD_PHASE_CHANGED", title: target === "SELF_EVAL" ? "Kỳ tự chấm đã mở" : "Kỳ tự chấm đã kết thúc",
            body: target === "SELF_EVAL" ? `Kỳ ${period.name} đã mở tự chấm ${displayWindow(start, deadline)}` : `Kỳ ${period.name} đã kết thúc tự chấm ${displayWindow(start, deadline)} và chuyển sang thẩm định lần đầu`,
            dedupeKey: `PERIOD_PHASE_CHANGED:${periodId}:${target}`, refType: "EVALUATION_PERIOD", refId: periodId,
            ...(target === "SELF_EVAL" ? { expiresAt: deadline } : {}),
          })));
        }
      }
    }, { timeout: 10_000, maxWait: 10_000 });

    // Có thể tiếp tục sau crash dù phase đã đổi; mỗi lô nhả khóa để API khác tiến lên.
    while (await this.reconcileBatch(periodId)) { /* drain expired records */ }
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.$transaction(async (tx) => {
        await lockPeriod(tx, periodId, "shared");
        const period = await tx.evaluationPeriod.findUnique({ where: { id: periodId } });
        if (!period?.publishedAt) return [];
        const evaluations = await tx.evaluation.findMany({ where: { periodId, status: { in: ["DRAFT", "SUPPLEMENT_REQUESTED"] }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 100 });
        const now = await this.state.databaseNow(tx);
        const users = await tx.user.findMany({ where: { isActive: true, role: "UNIT", unitId: { in: evaluations.map((item) => item.unitId) } }, select: { id: true, unitId: true } });
        const byUnit = new Map(users.map((user) => [user.unitId, user.id]));
        await this.notifications.enqueueMany(tx, evaluations.flatMap((evaluation) => {
          const initial = evaluation.status === "DRAFT" && ["SETUP", "SELF_EVAL"].includes(period.phase);
          const start = initial ? period.selfEvalStart : evaluation.status === "SUPPLEMENT_REQUESTED" ? evaluation.supplementStartAt : null;
          const deadline = initial ? period.selfEvalDeadline : evaluation.supplementDeadline;
          const userId = byUnit.get(evaluation.unitId);
          if (!userId || !start || !deadline || !isDeadlineReminderDue(start, deadline, now)) return [];
          return [{ userId, type: initial ? "SELF_EVAL_REMINDER" : "SUPPLEMENT_REMINDER", title: "Nhắc thời hạn hồ sơ", body: `Hồ sơ kỳ ${period.name} có thời gian ${displayWindow(start, deadline)}`,
            dedupeKey: `REMINDER:${evaluation.id}:${initial ? "INITIAL" : "SUPPLEMENT"}:${deadline.toISOString()}`, refType: "EVALUATION", refId: evaluation.id, expiresAt: deadline }];
        }));
        return evaluations;
      }, { timeout: 10_000, maxWait: 10_000 });
      if (page.length < 100) break;
      cursor = page.at(-1)!.id;
    }
  }

  private async reconcileBatch(periodId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockPeriod(tx, periodId, "shared");
      const period = await tx.evaluationPeriod.findUnique({ where: { id: periodId } });
      if (!period?.publishedAt) return false;
      const now = await this.state.databaseNow(tx);
      const initialDue = !!period.selfEvalDeadline && now >= period.selfEvalDeadline;
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM evaluations WHERE period_id = ${periodId}::uuid
        AND ((status = 'DRAFT' AND ${initialDue}) OR (status = 'SUPPLEMENT_REQUESTED' AND supplement_deadline <= ${now}))
        ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return false;
      const evaluations = await tx.evaluation.findMany({ where: { id: { in: rows.map((row) => row.id) } }, orderBy: { id: "asc" } });
      await this.state.reconcileExpiredMany(tx, evaluations, period, now);
      return true;
    }, { timeout: 10_000, maxWait: 10_000 });
  }
}
