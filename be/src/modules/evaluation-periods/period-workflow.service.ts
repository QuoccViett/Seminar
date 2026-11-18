import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Evaluation, EvaluationPeriod, Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ERROR_CODES } from "../../common/constants/error-codes.js";
import { AuditService } from "../../common/services/audit.service.js";
import { ClockService } from "../../common/services/clock.service.js";
import { DeadlineCalculator } from "../../common/services/deadline-calculator.js";
import { lockPeriod } from "../../common/services/period-lock.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PHASE_TARGETS, type PhaseTarget } from "./dto/transition-phase.dto.js";

const PHASE_LABELS: Record<string, string> = {
  SETUP: "Thiết lập", SELF_EVAL: "Tự chấm", FIRST_REVIEW: "Thẩm định lần đầu",
  SUPPLEMENT: "Bổ sung", FINAL_REVIEW: "Thẩm định cuối", CLOSED: "Đã đóng",
};

/** Quản lý đồ thị giai đoạn và lịch bổ sung thuộc cấu hình VC08
 * Các consumer về điểm, job và thẩm định phải lấy khóa kỳ trước khóa hồ sơ theo cùng thứ tự
 * Dịch vụ không nhập điểm hoặc chốt kết quả thay nghiệp vụ VC09–VC12
 */
@Injectable()
export class PeriodWorkflowService {
  /** Nhận các dependency chung qua DI, không tự mở kết nối hoặc tạo bản ghi lúc khởi tạo
   * Prisma giữ transaction, clock cấp giờ, helper tính lịch còn audit/thông báo ghi cùng kết nối
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly deadlines: DeadlineCalculator,
    private readonly notifications: NotificationsService,
  ) {}

  /** Tính danh sách lệnh khả dụng từ snapshot DB và giờ server cho giao diện Admin
   * periodId là UUID đã được controller kiểm tra, kết quả không phải giấy phép ghi
   * POST luôn khóa và kiểm lại để chống thay đổi điều kiện sau khi mở hộp xác nhận
   */
  async options(periodId: string) {
    const period = await this.prisma.evaluationPeriod.findUnique({ where: { id: periodId }, include: { evaluations: true } });
    if (!period) throw this.notFound();
    const now = this.clock.now();
    return {
      periodId, phase: period.phase, serverTime: now.toISOString(),
      options: PHASE_TARGETS.map((phase) => {
        const reason = this.rejection(period, period.evaluations, phase, now);
        return { phase, allowed: reason === null, message: reason ?? `Có thể chuyển sang ${PHASE_LABELS[phase]}` };
      }),
    };
  }

  /** Chuyển giai đoạn sau khi lấy khóa kỳ rồi khóa các hồ sơ theo thứ tự cố định
   * target là đích trong allowlist, actorId là Admin thật hoặc null khi job gọi lại
   * Giờ được đọc sau khi chờ khóa để request tới trước hạn không giữ quyền qua hạn
   * Mọi thay đổi giai đoạn, khóa hồ sơ, history, audit và hộp thư commit cùng nhau
   * Lệnh lặp hoặc chuyển lùi bị từ chối, vì vậy không tạo dấu vết hoặc thông báo trùng
   */
  async transition(periodId: string, target: PhaseTarget, actorId: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await lockPeriod(tx, periodId);
      const period = await tx.evaluationPeriod.findUnique({ where: { id: periodId } });
      if (!period) throw this.notFound();
      // Khóa cùng connection trước khi đọc để không chạy song song với lưu/nộp/chốt hồ sơ
      await tx.$queryRaw`SELECT id FROM evaluations WHERE period_id = ${periodId}::uuid ORDER BY id FOR UPDATE`;
      const evaluations = await tx.evaluation.findMany({ where: { periodId }, orderBy: { id: "asc" } });
      const now = this.clock.now();
      const reason = this.rejection(period, evaluations, target, now);
      if (reason) throw new BadRequestException({ code: ERROR_CODES.BUSINESS_RULE_VIOLATION, message: reason });

      // Các chuyển trạng thái theo hạn chỉ chạy sau khi đích đã hợp lệ để lệnh sai không ghi dở dang
      for (const evaluation of evaluations) {
        if (target === "FIRST_REVIEW" && evaluation.status === "DRAFT") {
          await this.changeStatus(tx, evaluation, "PENDING_REVIEW", now, "Đã hết thời gian tự chấm", { autoLockedAt: now });
        } else if (target === "FINAL_REVIEW" && evaluation.status === "SUPPLEMENT_REQUESTED") {
          await this.changeStatus(tx, evaluation, "SUPPLEMENT_EXPIRED", now, "Đã hết thời gian bổ sung");
        }
      }
      const after = await tx.evaluationPeriod.update({
        where: { id: periodId }, data: { phase: target, updatedAt: now, ...(target === "CLOSED" ? { finalizedAt: now } : {}) },
      });
      await this.audit.record({ actorId, action: "TRANSITION_PHASE", entity: "EvaluationPeriod", entityId: periodId,
        before: { phase: period.phase, finalizedAt: period.finalizedAt?.toISOString() ?? null },
        after: { phase: target, finalizedAt: after.finalizedAt?.toISOString() ?? null },
      }, tx);
      const recipients = await tx.user.findMany({
        where: { isActive: true, OR: [{ role: "ADMIN" }, { role: "UNIT", unitId: { in: evaluations.map((item) => item.unitId) } }] },
        select: { id: true },
      });
      for (const user of recipients) {
        await this.notifications.notifyUser(tx, {
          userId: user.id, type: "PERIOD_PHASE_CHANGED", title: "Kỳ đánh giá đã chuyển giai đoạn",
          body: `Kỳ ${period.name} chuyển sang ${PHASE_LABELS[target]}`,
          dedupeKey: `PERIOD_PHASE_CHANGED:${periodId}:${target}`, refType: "EVALUATION_PERIOD", refId: periodId, channels: [],
        });
      }
      return after;
    // Chuyển giai đoạn ghi history/audit và hộp thư cho cả kỳ, cần ngân sách hữu hạn lớn hơn mặc định 5 giây
    // Nếu quá ngân sách vẫn rollback toàn bộ, không trả thành công khi chỉ một phần đơn vị được khóa
    }, { timeout: 30_000, maxWait: 10_000 });
  }

  /** Tính lịch xem trước bằng cùng helper sẽ dùng khi VC12 lưu snapshot yêu cầu
   * start là ISO có offset đã qua DTO, đầu ra UTC và câu hiển thị theo giờ Việt Nam
   * Không ghi DB hoặc suy diễn từ supplementHours, ngày cuối tuần bị helper từ chối
   */
  previewSupplement(start: string) {
    const supplementStartAt = new Date(start);
    const deadline = this.deadlines.supplementDeadline(supplementStartAt);
    const lastMinute = new Date(deadline.getTime() - 60_000);
    return {
      supplementStartAt: supplementStartAt.toISOString(), supplementDeadline: deadline.toISOString(),
      serverTime: this.clock.now().toISOString(), policy: "TEMPORARY_WEEKDAY",
      displayUntil: `đến hết 23:59 ngày ${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(lastMinute)}`,
      notice: "Lịch bổ sung tạm, chờ giảng viên xác nhận",
    };
  }

  /** Trả lý do từ chối hoặc null nếu một cạnh đồ thị thỏa toàn bộ điều kiện
   * period/evaluations là snapshot sau khóa khi ghi hoặc snapshot tham khảo khi GET
   * Yêu cầu bổ sung hết hạn được coi là sẵn sàng chuyển cuối và sẽ reconcile lúc ghi
   * Không cho kỳ CLOSED hoặc kỳ review quay lại tự chấm dù lịch bị thay đổi ngoài API
   */
  private rejection(period: EvaluationPeriod, evaluations: Evaluation[], target: PhaseTarget, now: Date): string | null {
    if (!period.publishedAt) return "Kỳ đánh giá chưa được công bố";
    const edges: Record<string, readonly string[]> = {
      SETUP: ["SELF_EVAL", "FIRST_REVIEW"], SELF_EVAL: ["FIRST_REVIEW"],
      FIRST_REVIEW: ["SUPPLEMENT", "FINAL_REVIEW"], SUPPLEMENT: ["FINAL_REVIEW"], FINAL_REVIEW: ["CLOSED"], CLOSED: [],
    };
    if (!edges[period.phase]?.includes(target)) return "Không được chuyển lùi, bỏ qua hoặc lặp giai đoạn này";
    if (!period.selfEvalStart || !period.selfEvalDeadline || period.selfEvalStart >= period.selfEvalDeadline) return "Kỳ đánh giá chưa có lịch tự chấm hợp lệ";
    if (!evaluations.length) return "Kỳ đánh giá chưa có hồ sơ để chuyển giai đoạn";
    if (target === "SELF_EVAL" && !(now >= period.selfEvalStart && now < period.selfEvalDeadline)) return "Chỉ được mở tự chấm trong cửa sổ đã cấu hình";
    if (target === "FIRST_REVIEW" && now < period.selfEvalDeadline) return "Chưa đến thời hạn kết thúc tự chấm";
    if (target === "SUPPLEMENT" && !evaluations.some((item) => item.status === "SUPPLEMENT_REQUESTED" && item.firstReviewedAt
      && item.supplementStartAt && item.supplementDeadline && item.supplementStartAt < item.supplementDeadline && now < item.supplementDeadline)) {
      return "Cần có hồ sơ đã thẩm định lần đầu với lịch bổ sung còn hiệu lực";
    }
    if (target === "FINAL_REVIEW") {
      if (evaluations.some((item) => item.status === "DRAFT" || (!item.firstReviewedAt && item.status !== "FINALIZED"))) return "Cần hoàn tất thẩm định lần đầu cho mọi hồ sơ";
      if (evaluations.some((item) => item.status === "SUPPLEMENT_REQUESTED" && (!item.supplementDeadline || now < item.supplementDeadline))) return "Còn hồ sơ đang trong vòng bổ sung chưa kết thúc";
    }
    if (target === "CLOSED" && evaluations.some((item) => item.status !== "FINALIZED" || !item.finalizedAt || !item.finalizedById
      || item.finalScore === null || item.finalPercent === null || !item.finalRating)) return "Chỉ được đóng kỳ khi mọi hồ sơ đã chốt đủ kết quả";
    return null;
  }

  /** Ghi chuyển trạng thái do hạn thời gian trong cùng transaction giai đoạn
   * evaluation là hàng đã khóa, status là đích tự động và extra mang dấu auto-lock nếu có
   * actorId null thể hiện hệ thống, giữ submittedAt rỗng khi chưa nộp chủ động
   */
  private async changeStatus(tx: Prisma.TransactionClient, evaluation: Evaluation, status: string, now: Date, comment: string, extra: { autoLockedAt?: Date } = {}) {
    await tx.evaluation.update({ where: { id: evaluation.id }, data: { status, updatedAt: now, ...extra } });
    await tx.statusHistory.create({ data: { id: randomUUID(), evaluationId: evaluation.id, actorId: null, fromStatus: evaluation.status, toStatus: status, comment, createdAt: now } });
    await this.audit.record({ actorId: null, action: "AUTO_STATUS", entity: "Evaluation", entityId: evaluation.id,
      before: { status: evaluation.status }, after: { status, reason: comment },
    }, tx);
  }

  /** Tạo lỗi 404 tiếng Việt, không trả chi tiết Prisma cho mã kỳ không tồn tại */
  private notFound() {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Không tìm thấy kỳ đánh giá" });
  }
}
