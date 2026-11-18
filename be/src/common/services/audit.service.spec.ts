import assert from "node:assert/strict";
import { test } from "node:test";
import { AuditService } from "./audit.service.js";
import { ClockService } from "./clock.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";

/** Kiểm tra snapshot lồng trong mảng được che bí mật mà không sửa dữ liệu đầu vào
 * Đối tượng lưu qua Prisma giả để kiểm tra dữ liệu ngay trước ranh giới cơ sở dữ liệu
 */
test("che thông tin xác thực lồng nhau trong audit", async () => {
  let saved: unknown;
  const prisma = { auditLog: { create: async (args: unknown) => { saved = args; } } } as unknown as PrismaService;
  const service = new AuditService(prisma, new ClockService());
  const after = { items: [{ passwordHash: "bi-mat", name: "Tên", auth: "auth-thu", hash: "hash-thu", nonce: "nonce-thu", tag: "tag-thu", credentialCiphertext: "cipher-thu" }], refreshToken: "token-thu" };
  await service.record({ actorId: null, action: "UPDATE", entity: "User", entityId: "1", after });
  assert.doesNotMatch(JSON.stringify(saved), /bi-mat|token-thu|auth-thu|hash-thu|nonce-thu|tag-thu|cipher-thu/);
  assert.equal(after.items[0].passwordHash, "bi-mat");
  assert.match(JSON.stringify(saved), /Tên/);
});
