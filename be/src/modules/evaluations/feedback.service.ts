import { ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AuditService } from "../../common/services/audit.service.js";
import { lockPeriod } from "../../common/services/period-lock.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import type { CreateFeedbackDto, TimelineQueryDto } from "./dto/feedback.dto.js";

const authorSelect = { id: true, fullName: true } as const;
type FeedbackRow = Prisma.EvaluationFeedbackGetPayload<{ include: { author: { select: typeof authorSelect } } }>;

/** Chiếu bản ghi thành dữ liệu công khai, không đưa tài khoản hay thuộc tính nội bộ vào API */
function present(row: FeedbackRow) {
  return { id: row.id, evaluationId: row.evaluationId, authorId: row.authorId, authorName: row.author.fullName, type: row.type, content: row.content, createdAt: row.createdAt };
}

/** Tách trao đổi khỏi chấm điểm để một phản hồi không thể mở vòng bổ sung hoặc sửa hồ sơ
 * Mọi truy vấn kiểm sở hữu trước đọc nội dung, ghi dùng khóa cùng thứ tự với VC12
 */
@Injectable()
export class FeedbackService {
  /** Tiêm tường minh các dependency để giữ hoạt động ở cả tsx ESM và bản build */
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService, @Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  /** Đọc hồ sơ trong phạm vi phiên, role lạ hoặc UNIT thiếu đơn vị luôn trả 404
   * Dùng chung cho lịch sử và trao đổi, không tin authorId/unitId từ client
   */
  private async scoped(tx: Prisma.TransactionClient, id: string, user: CurrentUser) {
    if (!["ADMIN", "UNIT"].includes(user.role) || (user.role === "UNIT" && !user.unitId)) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
    const row = await tx.evaluation.findFirst({ where: { id, ...(user.role === "UNIT" ? { unitId: user.unitId! } : {}) }, include: { period: true } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
    return row;
  }

  /** Tính quyền từ snapshot và thời gian DB, không cấp quyền bằng đồng hồ trình duyệt
   * UNIT trước mở không đọc nội dung trao đổi vì có thể chứa thông tin tiêu chí
   * Sau chốt chỉ đọc để bảo toàn hồ sơ đã nghiệm thu
   */
  private permissions(row: Awaited<ReturnType<FeedbackService["scoped"]>>, user: CurrentUser, now: Date) {
    if (user.role === "UNIT" && (!row.period.publishedAt || !row.period.selfEvalStart || now < row.period.selfEvalStart)) throw new ForbiddenException({ code: "FEEDBACK_LOCKED", message: "Chưa đến giờ mở nội dung trao đổi của hồ sơ" });
    const lockedReason = row.status === "FINALIZED" || row.period.phase === "CLOSED" ? "Hồ sơ đã chốt hoặc kỳ đã đóng, chỉ được đọc trao đổi" : null;
    return { canPost: !lockedReason, allowedTypes: lockedReason ? [] : user.role === "ADMIN" ? ["GENERAL", "EXPLANATION_REQUEST"] : ["UNIT_REPLY"], lockedReason };
  }

  /** Lấy trang trao đổi và tổng từ cùng snapshot, thứ tự UUID giải quyết timestamp trùng
   * Quyền gửi đi kèm giúp FE khóa đúng theo server, không tự suy diễn trạng thái
   */
  async list(id: string, query: TimelineQueryDto, user: CurrentUser) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.scoped(tx, id, user);
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT timezone('UTC', statement_timestamp()) AS now`;
      const permissions = this.permissions(row, user, clock!.now);
      const items = await tx.evaluationFeedback.findMany({ where: { evaluationId: id }, include: { author: { select: authorSelect } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
      return { items: items.map(present), page: query.page, pageSize: query.pageSize, total: await tx.evaluationFeedback.count({ where: { evaluationId: id } }), ...permissions };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  /** Ghi văn bản sau kiểm quyền và chống spam bằng khóa tác giả trên toàn hệ thống
   * Khóa kỳ rồi hồ sơ để tuần tự với finalize, khóa advisory tác giả tránh vượt hạn trên hai hồ sơ
   * Giờ lấy sau khóa, audit và hộp thư cùng transaction nên lỗi bất kỳ không để phản hồi mồ côi
   * Hộp thư chỉ báo có trao đổi, không gửi nội dung hồ sơ sang provider ngoài
   */
  async create(id: string, dto: CreateFeedbackDto, user: CurrentUser) {
    return this.prisma.$transaction(async (tx) => {
      const ref = await this.scoped(tx, id, user);
      await lockPeriod(tx, ref.periodId, "shared");
      await tx.$queryRaw`SELECT id FROM evaluations WHERE id = ${id}::uuid FOR UPDATE`;
      // Chỉ SELECT hằng số từ hàm khóa vì Prisma không giải mã kiểu void do PostgreSQL trả về
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`feedback:${user.id}`}, 0))`;
      const row = await this.scoped(tx, id, user);
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT timezone('UTC', statement_timestamp()) AS now`;
      const now = clock!.now; const permission = this.permissions(row, user, now);
      if (!permission.canPost) throw new ForbiddenException({ code: "FEEDBACK_LOCKED", message: permission.lockedReason! });
      if (!permission.allowedTypes.includes(dto.type)) throw new ForbiddenException({ code: "FORBIDDEN", message: "Vai trò hiện tại không được gửi loại phản hồi này" });
      const recent = await tx.evaluationFeedback.count({ where: { authorId: user.id, evaluationId: id, createdAt: { gt: new Date(+now - 30000) } } });
      const hourly = await tx.evaluationFeedback.count({ where: { authorId: user.id, createdAt: { gt: new Date(+now - 3600000) } } });
      if (recent || hourly >= 20) throw new HttpException({ code: "FEEDBACK_RATE_LIMITED", message: "Bạn gửi phản hồi quá nhanh, vui lòng chờ ít nhất 30 giây và không quá 20 phản hồi mỗi giờ" }, 429);
      const saved = await tx.evaluationFeedback.create({ data: { id: randomUUID(), evaluationId: id, authorId: user.id, type: dto.type, content: dto.content, createdAt: now }, include: { author: { select: authorSelect } } });
      await this.audit.record({ actorId: user.id, action: "FEEDBACK_CREATED", entity: "EvaluationFeedback", entityId: saved.id, after: { evaluationId: id, type: saved.type, contentLength: saved.content.length } }, tx);
      const recipients = await tx.user.findMany({ where: user.role === "UNIT" ? { role: "ADMIN", isActive: true } : { role: "UNIT", unitId: row.unitId, isActive: true }, select: { id: true } });
      for (const recipient of recipients) await this.notifications.notifyUser(tx, { userId: recipient.id, type: "EVALUATION_FEEDBACK", title: "Có phản hồi mới về hồ sơ đánh giá", body: "Vui lòng mở hồ sơ để đọc nội dung trao đổi", refType: "Evaluation", refId: id, dedupeKey: `feedback:${saved.id}`, channels: [] });
      return present(saved);
    });
  }

  /** Đọc lịch sử chỉ thêm theo phạm vi, actor null của job được đặt tên Hệ thống
   * Chỉ chiếu tên người thao tác, không trả hồ sơ User hoặc dữ liệu chấm điểm
   */
  async history(id: string, query: TimelineQueryDto, user: CurrentUser) {
    return this.prisma.$transaction(async (tx) => {
      await this.scoped(tx, id, user);
      const items = await tx.statusHistory.findMany({ where: { evaluationId: id }, include: { actor: { select: authorSelect } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
      return { items: items.map(({ actor, ...entry }) => ({ ...entry, actorName: actor?.fullName ?? "Hệ thống" })), page: query.page, pageSize: query.pageSize, total: await tx.statusHistory.count({ where: { evaluationId: id } }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
