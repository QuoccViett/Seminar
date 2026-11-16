import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ClockService } from "./clock.service.js";

export type AuditPayload = {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ip?: string | null;
};

/** Che đệ quy thông tin xác thực trong snapshot trước khi lưu audit
 * Giữ cấu trúc mảng và đối tượng để phục vụ truy vết, thay giá trị nhạy cảm bằng nhãn cố định
 * Giá trị null và nguyên thủy được giữ nguyên, không sửa đối tượng đầu vào của nghiệp vụ
 */
function redactAudit(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  if (Array.isArray(value)) return value.map((item) => item === null ? null : redactAudit(item));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /password|token|secret|authorization|credential|key|ciphertext|cookie|p256dh|^auth$/i.test(key)
      ? "[ĐÃ CHE]" : item === null || item === undefined ? null : redactAudit(item),
  ]));
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService, private readonly clock: ClockService) {}

  /** Ghi một bản audit bằng giao dịch được cung cấp hoặc kết nối mặc định
   * Snapshot được che thông tin xác thực ở mọi cấp trước khi lưu, kể cả trong mảng
   * Phân biệt trường không truyền với JSON null để giữ ý nghĩa dữ liệu ban đầu
   */
  async record(payload: AuditPayload, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        id: randomUUID(), actorId: payload.actorId, action: payload.action,
        entity: payload.entity, entityId: payload.entityId,
        before: payload.before === undefined ? Prisma.DbNull : payload.before === null ? Prisma.JsonNull : redactAudit(payload.before),
        after: payload.after === undefined ? Prisma.DbNull : payload.after === null ? Prisma.JsonNull : redactAudit(payload.after),
        ip: payload.ip ?? null, createdAt: this.clock.now(),
      },
    });
  }
}
