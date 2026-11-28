import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { validate } from "class-validator";
import { Prisma } from "../../generated/prisma/client.js";
import { ReviewScoreDto } from "./dto/review.dto.js";
import { ReviewService } from "./review.service.js";

/** Dựng transaction giả để kiểm các nhánh nghiệp vụ độc lập với PostgreSQL
 * Ghi lại điểm và audit để kiểm lý do bị từ chối không tạo dữ liệu
 */
function fixture() {
  const now = new Date("2026-11-18T00:00:00Z");
  const score = { id: "score", selfScore: new Prisma.Decimal(8), adminScore: null, adminComment: null, criterion: { periodId: "period", maxScore: new Prisma.Decimal(10), children: [] } };
  const evaluation = { id: "evaluation", status: "PENDING_REVIEW", period: { phase: "FIRST_REVIEW" } };
  const writes: unknown[] = [];
  const tx = {
    $queryRaw: async () => [],
    evaluation: { findUnique: async (args: { select?: unknown }) => args.select ? { periodId: "period" } : evaluation },
    criterionScore: { findUnique: async () => score, update: async ({ data }: { data: object }) => { writes.push(data); return { ...score, ...data }; } },
  };
  const prisma = { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) };
  const audit = { record: async (entry: unknown) => { writes.push(entry); } };
  const state = { databaseNow: async () => now, reconcileSupplement: async () => evaluation };
  const service = new ReviewService(prisma as never, audit as never, state as never, {} as never, {} as never, {} as never);
  return { service, writes, score, evaluation };
}

/** Kiểm điểm thay đổi cần lý do, quá tối đa bị chặn và điểm hợp lệ ghi cùng audit
 * Điểm bằng tự chấm vẫn chấp nhận số không như một giá trị thật
 */
test("thẩm định kiểm lý do và điểm tối đa trước khi ghi audit", async () => {
  const { service, writes, score } = fixture();
  const admin = { id: "admin", role: "ADMIN" as const, unitId: null };
  await assert.rejects(service.review("evaluation", "criterion", { adminScore: 6 }, admin));
  await assert.rejects(service.review("evaluation", "criterion", { adminScore: 11, adminComment: "Lý do" }, admin));
  assert.equal(writes.length, 0);
  const result = await service.review("evaluation", "criterion", { adminScore: 6, adminComment: "Thiếu minh chứng" }, admin);
  assert.equal(result?.adminScore, 6);
  assert.equal(result?.reviewedById, "admin");
  assert.equal(writes.length, 2);
  score.selfScore = new Prisma.Decimal(0);
  assert.equal((await service.review("evaluation", "criterion", { adminScore: 0 }, admin))?.adminScore, 0);
});

/** DTO từ chối điểm âm, vô hạn và quá hai chữ số thập phân trước khi gọi service
 * UNIT bị chặn cả khi service được gọi trực tiếp ngoài controller có guard
 */
test("validation và vai trò bảo vệ đầu vào thẩm định", async () => {
  for (const value of [-1, Infinity, 1.001]) {
    assert.ok((await validate(Object.assign(new ReviewScoreDto(), { adminScore: value }))).length);
  }
  const { service, writes } = fixture();
  await assert.rejects(service.review("evaluation", "criterion", { adminScore: 8 }, { id: "unit", role: "UNIT", unitId: "unit" }));
  assert.equal(writes.length, 0);
});

test("trao đổi yêu cầu bổ sung lưu đúng mã cho từng ghi chú", async () => {
  const now = new Date("2026-11-18T00:00:00Z");
  const scores = ["1.1.2", "1.1.1"].map((code) => ({ id: `score-${code}`, criterionId: code, criterion: { code }, evidences: [], selfScore: null, selfNote: null, adminScore: null, adminComment: null, reviewedById: null, reviewedAt: null }));
  let content = "";
  const tx = {
    $queryRaw: async () => [],
    evaluation: { findUnique: async (args: { select?: unknown }) => args.select ? { periodId: "period" } : { period: { phase: "SUPPLEMENT", name: "Kỳ" }, status: "PENDING_REVIEW", firstReviewedAt: now, unitId: "unit" }, update: async () => ({}) },
    criterionScore: { findMany: async () => scores, update: async () => ({}) },
    evaluationFeedback: { create: async ({ data }: { data: { content: string } }) => { content = data.content; return { id: "feedback" }; } },
    statusHistory: { create: async () => ({}) }, user: { findMany: async () => [] },
  };
  const prisma = { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) };
  const service = new ReviewService(prisma as never, { record: async () => {} } as never, { databaseNow: async () => now } as never, {} as never, { supplementDeadline: (_start: Date, deadline: Date) => deadline } as never, {} as never);
  await service.requestSupplement("evaluation", { supplementStartAt: "2026-11-19T00:00:00Z", supplementDeadline: "2026-11-20T00:00:00Z", items: [{ criterionId: "1.1.1", note: " cần bổ sung minh chứng " }, { criterionId: "1.1.2", note: "Cần giải trình\nthêm chi tiết" }] }, { id: "admin", role: "ADMIN", unitId: null });
  assert.equal(content, "Mã 1.1.1 - cần bổ sung minh chứng\nMã 1.1.2 - Cần giải trình\nthêm chi tiết");
});
