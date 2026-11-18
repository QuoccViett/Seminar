import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AuditService, redactAudit } from "../../common/services/audit.service.js";
import type { CreateAuditLogDto } from "./dto/create-audit-log.dto.js";
import type { QueryAuditLogDto } from "./dto/query-audit-log.dto.js";

const actorSelect = { id: true, fullName: true } as const;
type AuditRow = Prisma.AuditLogGetPayload<{ include: { actor: { select: typeof actorSelect } } }>;

/** Chiếu audit công khai và che lại snapshot cũ khi đọc, không sửa lịch sử đã lưu
 * actor null được hiển thị Hệ thống để nhận diện job, không trả thông tin tài khoản
 */
function present({ actor, before, after, ...entry }: AuditRow) {
  return { ...entry, actorName: actor?.fullName ?? "Hệ thống", before: before === null ? null : redactAudit(before as Prisma.InputJsonValue), after: after === null ? null : redactAudit(after as Prisma.InputJsonValue) };
}

/** Chỉ phục vụ truy vấn audit, mọi lệnh ghi vẫn đi qua bộ lọc nội bộ dùng chung */
@Injectable()
export class AuditLogsService {
  /** Tiêm tường minh để tránh lỗi metadata khi runtime tsx dùng ESM */
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService) {}

  /** Lọc chính xác các định danh và khoảng thời gian có offset, không nhận SQL/sort từ client
   * Hai truy vấn chung snapshot REPEATABLE READ, UUID làm khóa phụ cho timestamp trùng
   * Khoảng ngược trả lỗi trước DB, tránh hiểu nhầm là không có dữ liệu
   */
  async findAll(query: QueryAuditLogDto) {
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "Thời gian bắt đầu không được sau thời gian kết thúc", details: [{ field: "from", messages: ["Cần chọn khoảng thời gian theo thứ tự tăng dần"] }] });
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entity ? { entity: query.entity } : {}), ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}), ...(query.actorId ? { actorId: query.actorId.toUpperCase() === "SYSTEM" ? null : query.actorId } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, include: { actor: { select: actorSelect } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.auditLog.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items: items.map(present), page: query.page, pageSize: query.pageSize, total };
  }

  /** Đọc một audit bằng UUID đã kiểm, thiếu trả 404 tiếng Việt an toàn */
  async findOne(id: string) {
    const entry = await this.prisma.auditLog.findUnique({ where: { id }, include: { actor: { select: actorSelect } } });
    if (!entry) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy nhật ký hoạt động" });
    return present(entry);
  }

  /** Giữ điểm ghi nội bộ tương thích, không cho client tự khai actor hoặc snapshot */
  record(data: CreateAuditLogDto) { return this.audit.record({ ...data, actorId: data.actorId ?? null }); }
}
