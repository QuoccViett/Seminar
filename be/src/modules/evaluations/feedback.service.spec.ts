import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FeedbackService } from "./feedback.service.js";
import { TimelineQueryDto } from "./dto/feedback.dto.js";

/** Dựng snapshot tối thiểu để kiểm projection và chính sách đọc độc lập với HTTP
 * Fake chỉ thuộc unit test, cạnh tranh/transaction được kiểm tiếp với PostgreSQL thật
 */
function fixture(start = new Date(0), status = "PENDING_REVIEW") {
  let reads = 0;
  const tx = { evaluation: { findFirst: async () => { reads++; return { id: "hồ sơ", status, period: { publishedAt: new Date(0), selfEvalStart: start, phase: "FIRST_REVIEW" } }; } }, $queryRaw: async () => [{ now: new Date("2026-11-18T00:00:00Z") }], evaluationFeedback: { findMany: async () => [], count: async () => 0 } };
  const prisma = { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
  return { service: new FeedbackService(prisma as never, {} as never, {} as never), reads: () => reads };
}

/** UNIT thiếu đơn vị bị chặn trước truy vấn để không biến dữ liệu phiên lỗi thành quyền ADMIN */
test("UNIT thiếu đơn vị không truy vấn được phản hồi", async () => {
  const f = fixture(); await assert.rejects(f.service.list("hồ sơ", new TimelineQueryDto(), { id: "người", role: "UNIT", unitId: null }), /Không tìm thấy/); assert.equal(f.reads(), 0);
});

/** Snapshot server khóa trước mở và sau chốt, không dựa vào thời gian trình duyệt */
test("phản hồi khóa UNIT trước mở và chỉ đọc sau chốt", async () => {
  const user = { id: "người", role: "UNIT" as const, unitId: "đơn vị" };
  await assert.rejects(fixture(new Date("2027-01-01Z")).service.list("hồ sơ", new TimelineQueryDto(), user), /Chưa đến giờ/);
  const result = await fixture(new Date(0), "FINALIZED").service.list("hồ sơ", new TimelineQueryDto(), user);
  assert.equal(result.canPost, false); assert.deepEqual(result.allowedTypes, []); assert.equal(result.total, 0);
});
