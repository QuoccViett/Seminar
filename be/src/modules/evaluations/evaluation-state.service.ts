import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Evaluation, EvaluationPeriod, Prisma } from "../../generated/prisma/client.js";
import { AuditService } from "../../common/services/audit.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";

/** Use-case trạng thái hồ sơ dùng chung cho API, chuyển giai đoạn và scheduler VC11
 * Bên gọi phải giữ khóa kỳ trước khóa hồ sơ, mọi dấu vết dùng cùng transaction
 * Không tự chốt hồ sơ và không tính lịch bổ sung từ số giờ legacy
 */
@Injectable()
export class EvaluationStateService {
  /** Nhận audit và outbox qua DI rõ ràng để chạy được cả bản build lẫn runtime ESM */
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** Lấy giờ statement hiện tại từ DB sau khi chờ khóa, trả Date UTC cùng hệ quy chiếu trigger
   * Không dùng transaction_timestamp vì transaction có thể bắt đầu từ trước deadline
   * Chỉ dùng SQL hằng, không nhận thời gian client hoặc thay đổi đồng hồ hệ thống
   */
  async databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
    const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now`;
    return row!.now;
  }

  /** Chuyển DRAFT quá hạn sang chờ duyệt mà không bắt nhập đủ điểm hay minh chứng
   * Snapshot evaluation đã khóa và now lấy sau khóa, chỉ lần đầu ghi history/audit/outbox
   * Giữ submittedAt null để phân biệt tự nộp với khóa hệ thống dù scheduler chưa chạy
   * Trả snapshot mới cho cùng request, không cần đọc lại ngoài transaction
   */
  async reconcileInitial(tx: Prisma.TransactionClient, evaluation: Evaluation, period: EvaluationPeriod, now: Date): Promise<Evaluation> {
    if (evaluation.status !== "DRAFT" || !period.publishedAt || !period.selfEvalDeadline || now < period.selfEvalDeadline) return evaluation;
    return this.pendingReview(tx, evaluation, now, null, true);
  }

  /** Ghi nguyên tử trạng thái chờ duyệt, dấu thời gian, lịch sử và thông báo Admin
   * actorId có giá trị khi UNIT nộp sớm, null cho auto-lock; caller đã kiểm điều kiện
   * Dedupe theo hồ sơ/sự kiện giúp retry không tạo thêm delivery, không gọi provider trực tiếp
   */
  async pendingReview(tx: Prisma.TransactionClient, evaluation: Evaluation, now: Date, actorId: string | null, automatic: boolean): Promise<Evaluation> {
    const after = await tx.evaluation.update({ where: { id: evaluation.id }, data: {
      status: "PENDING_REVIEW", updatedAt: now, ...(automatic ? { autoLockedAt: now } : { submittedAt: now }),
    } });
    const comment = automatic ? "Đã hết thời gian tự chấm, hệ thống khóa hồ sơ để chờ duyệt" : "Đơn vị đã nộp hồ sơ tự chấm";
    await tx.statusHistory.create({ data: { id: randomUUID(), evaluationId: evaluation.id, actorId, fromStatus: evaluation.status, toStatus: after.status, comment, createdAt: now } });
    await this.audit.record({ actorId, action: automatic ? "AUTO_STATUS" : "SUBMIT", entity: "Evaluation", entityId: evaluation.id,
      before: { status: evaluation.status }, after: { status: after.status, submittedAt: after.submittedAt?.toISOString() ?? null, autoLockedAt: after.autoLockedAt?.toISOString() ?? null },
    }, tx);
    const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    for (const admin of admins) await this.notifications.notifyUser(tx, {
      userId: admin.id, type: automatic ? "EVALUATION_AUTO_LOCKED" : "EVALUATION_SUBMITTED",
      title: automatic ? "Hồ sơ đã được khóa theo hạn" : "Đơn vị đã nộp hồ sơ", body: comment,
      dedupeKey: `EVALUATION_PENDING_REVIEW:${evaluation.id}`, refType: "EVALUATION", refId: evaluation.id,
    });
    return after;
  }
}
