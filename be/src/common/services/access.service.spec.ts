import assert from "node:assert/strict";
import { test } from "node:test";
import { AccessService } from "./access.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";

/** Kiểm tra đầu vào sai bị từ chối trước DB để không phát sinh lỗi UUID hoặc lộ hồ sơ
 * Các trường hợp gồm mã hồ sơ sai, UNIT thiếu đơn vị và vai trò lạ
 * Số lượt truy vấn phải bằng không cho cả ba trường hợp
 */
test("từ chối quyền không hợp lệ trước khi truy vấn", async () => {
  let calls = 0;
  const prisma = { evaluation: { findFirst: async () => { calls++; return null; } } } as unknown as PrismaService;
  const service = new AccessService(prisma);
  const id = "6c2d5aa5-7ea1-4ab1-bfb8-1ae0d4928200";
  for (const [evaluationId, role, unitId] of [["sai", "ADMIN", null], [id, "UNIT", null], [id, "UNIT", "sai"], [id, "OTHER", null]] as const) {
    await assert.rejects(service.assertEvaluationAccess(evaluationId, role, unitId), { status: 404 });
  }
  assert.equal(calls, 0);
});
