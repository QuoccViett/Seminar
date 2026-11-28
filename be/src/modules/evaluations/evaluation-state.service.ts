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

  /** Caller đã khóa kỳ rồi các hồ sơ. Ghi trạng thái/history/audit/outbox theo lô,
   * cùng quy tắc với reconcile đơn; không gọi provider hoặc fanout từng người trong transaction.
   */
  async reconcileExpiredMany(tx: Prisma.TransactionClient, evaluations: Evaluation[], period: EvaluationPeriod, now: Date): Promise<void> {
    const initial = evaluations.filter((item) => item.status === "DRAFT" && period.publishedAt && period.selfEvalDeadline && now >= period.selfEvalDeadline);
    const supplement = evaluations.filter((item) => item.status === "SUPPLEMENT_REQUESTED" && item.supplementDeadline && now >= item.supplementDeadline);
    if (!initial.length && !supplement.length) return;
    if (initial.length) await tx.evaluation.updateMany({ where: { id: { in: initial.map((item) => item.id) }, status: "DRAFT" }, data: { status: "PENDING_REVIEW", autoLockedAt: now, updatedAt: now } });
    if (supplement.length) await tx.evaluation.updateMany({ where: { id: { in: supplement.map((item) => item.id) }, status: "SUPPLEMENT_REQUESTED" }, data: { status: "SUPPLEMENT_EXPIRED", updatedAt: now } });
    const rows = [...initial.map((item) => ({ item, status: "PENDING_REVIEW", comment: "Đã hết thời gian tự chấm, hệ thống khóa hồ sơ để chờ duyệt" })),
      ...supplement.map((item) => ({ item, status: "SUPPLEMENT_EXPIRED", comment: "Đã hết thời gian bổ sung" }))];
    await tx.statusHistory.createMany({ data: rows.map(({ item, status, comment }) => ({ id: randomUUID(), evaluationId: item.id, actorId: null, fromStatus: item.status, toStatus: status, comment, createdAt: now })) });
    await this.audit.recordMany(rows.map(({ item, status }) => ({ actorId: null, action: "AUTO_STATUS", entity: "Evaluation", entityId: item.id,
      before: { status: item.status }, after: status === "PENDING_REVIEW" ? { status, submittedAt: item.submittedAt?.toISOString() ?? null, autoLockedAt: now.toISOString() } : { status } })), tx);
    const users = await tx.user.findMany({ where: { isActive: true, OR: [{ role: "ADMIN" }, { role: "UNIT", unitId: { in: supplement.map((item) => item.unitId) } }] }, select: { id: true, role: true, unitId: true } });
    const admins = users.filter((user) => user.role === "ADMIN");
    const unitUsers = new Map(users.filter((user) => user.unitId).map((user) => [user.unitId!, user]));
    const formatter = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
    await this.notifications.enqueueMany(tx, rows.flatMap(({ item, status, comment }) => {
      const automatic = status === "PENDING_REVIEW";
      const unitUser = unitUsers.get(item.unitId);
      const recipients = automatic || !unitUser ? admins : [...admins, unitUser];
      const window = item.supplementStartAt && item.supplementDeadline ? ` từ ${formatter.format(item.supplementStartAt)} đến trước ${formatter.format(item.supplementDeadline)} theo giờ Việt Nam` : "";
      return recipients.map((user) => ({ userId: user.id, type: automatic ? "EVALUATION_AUTO_LOCKED" : "SUPPLEMENT_EXPIRED",
        title: automatic ? "Hồ sơ đã được khóa theo hạn" : "Đã hết hạn bổ sung", body: automatic ? comment : `Hồ sơ kỳ ${period.name} đã hết thời gian bổ sung${window}`,
        dedupeKey: automatic ? `EVALUATION_PENDING_REVIEW:${item.id}` : `SUPPLEMENT_EXPIRED:${item.id}`, refType: "EVALUATION", refId: item.id }));
    }));
  }

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

  /** Đồng bộ yêu cầu bổ sung đã hết hạn từ snapshot của hồ sơ đã khóa
   * Caller giữ khóa kỳ trước hồ sơ và cấp giờ sau khóa, chỉ SUPPLEMENT_REQUESTED tới deadline được đổi
   * History, audit và outbox cùng transaction để scheduler và API chuyển phase không ghi trùng
   * Không tính lại lịch, không đổi hồ sơ đã nộp hoặc tự chốt kết quả
   */
  async reconcileSupplement(tx: Prisma.TransactionClient, evaluation: Evaluation, period: EvaluationPeriod, now: Date): Promise<Evaluation> {
    if (evaluation.status !== "SUPPLEMENT_REQUESTED" || !evaluation.supplementDeadline || now < evaluation.supplementDeadline) return evaluation;
    const after = await tx.evaluation.update({ where: { id: evaluation.id }, data: { status: "SUPPLEMENT_EXPIRED", updatedAt: now } });
    await tx.statusHistory.create({ data: { id: randomUUID(), evaluationId: evaluation.id, actorId: null, fromStatus: evaluation.status, toStatus: after.status, comment: "Đã hết thời gian bổ sung", createdAt: now } });
    await this.audit.record({ actorId: null, action: "AUTO_STATUS", entity: "Evaluation", entityId: evaluation.id, before: { status: evaluation.status }, after: { status: after.status } }, tx);
    const users = await tx.user.findMany({ where: { isActive: true, OR: [{ role: "ADMIN" }, { role: "UNIT", unitId: evaluation.unitId }] }, select: { id: true } });
    const formatter = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
    const window = evaluation.supplementStartAt ? ` từ ${formatter.format(evaluation.supplementStartAt)} đến trước ${formatter.format(evaluation.supplementDeadline)} theo giờ Việt Nam` : "";
    for (const user of users) await this.notifications.notifyUser(tx, {
      userId: user.id, type: "SUPPLEMENT_EXPIRED", title: "Đã hết hạn bổ sung", body: `Hồ sơ kỳ ${period.name} đã hết thời gian bổ sung${window}`,
      dedupeKey: `SUPPLEMENT_EXPIRED:${evaluation.id}`, refType: "EVALUATION", refId: evaluation.id,
    });
    return after;
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

  /** Ghi trạng thái nộp bổ sung sau khi caller đã khóa và kiểm thay đổi từng lá
   * Thời gian từ DB và actor UNIT được ghi cùng history, audit và thông báo Admin
   * Không tự chốt kết quả hoặc mở thêm vòng bổ sung khi đã nộp
   */
  async submitSupplement(tx: Prisma.TransactionClient, evaluation: Evaluation, now: Date, actorId: string): Promise<Evaluation> {
    const after = await tx.evaluation.update({ where: { id: evaluation.id }, data: { status: "SUPPLEMENT_SUBMITTED", supplementSubmittedAt: now, updatedAt: now } });
    await tx.statusHistory.create({ data: { id: randomUUID(), evaluationId: evaluation.id, actorId, fromStatus: evaluation.status, toStatus: after.status, comment: "Đơn vị đã nộp nội dung bổ sung", createdAt: now } });
    await this.audit.record({ actorId, action: "SUPPLEMENT_SUBMIT", entity: "Evaluation", entityId: evaluation.id, before: { status: evaluation.status }, after: { status: after.status, supplementSubmittedAt: now.toISOString() } }, tx);
    const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    for (const admin of admins) await this.notifications.notifyUser(tx, { userId: admin.id, type: "SUPPLEMENT_SUBMITTED", title: "Đơn vị đã nộp bổ sung", body: "Hồ sơ đã được nộp bổ sung và chờ thẩm định", dedupeKey: `SUPPLEMENT_SUBMITTED:${evaluation.id}`, refType: "EVALUATION", refId: evaluation.id });
    return after;
  }
}
