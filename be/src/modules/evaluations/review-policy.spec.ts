import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type CriterionScore, type Evaluation, type EvaluationPeriod, type Evidence } from "../../generated/prisma/client.js";
import { captureSupplementBaseline, reviewPermissions, supplementChanged } from "./review-policy.js";
import { selfLockedReason } from "./evaluation-policy.js";

/** Kiểm biên mili giây bằng snapshot thuần, không thay đồng hồ máy hoặc DB
 * Mỗi tổ hợp phase và status được so với tập quyền đã chốt, deadline loại trừ đúng mốc
 */
test("ma trận quyền thẩm định và bổ sung tại các biên mili giây", () => {
  const start = new Date("2026-11-20T00:00:00Z"); const deadline = new Date("2026-11-20T17:00:00Z");
  const period = { publishedAt: start, phase: "SUPPLEMENT" } as EvaluationPeriod;
  const evaluation = { status: "SUPPLEMENT_REQUESTED", firstReviewedAt: start, supplementRequestedAt: start, supplementStartAt: start, supplementDeadline: deadline } as Evaluation;
  assert.ok(selfLockedReason(period, evaluation, new Date(+start - 1), true));
  assert.equal(selfLockedReason(period, evaluation, start, true), null);
  assert.equal(selfLockedReason(period, evaluation, new Date(+deadline - 1), true), null);
  assert.ok(selfLockedReason(period, evaluation, deadline, true));
  assert.equal(reviewPermissions(period, evaluation, new Date(+deadline - 1)).canReview, false);
  assert.equal(reviewPermissions(period, evaluation, deadline).canReview, true);
  for (const phase of ["SETUP", "SELF_EVAL", "FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW", "CLOSED"]) {
    period.phase = phase;
    for (const status of ["DRAFT", "PENDING_REVIEW", "SUPPLEMENT_REQUESTED", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED", "FINALIZED"]) {
      evaluation.status = status;
      const permissions = reviewPermissions(period, evaluation, start);
      const ready = ["PENDING_REVIEW", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"].includes(status);
      assert.equal(permissions.canReview, ["FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW"].includes(phase) && ready, `${phase}/${status}`);
      assert.equal(permissions.canFinalize, phase === "FINAL_REVIEW" && ready, `${phase}/${status}`);
    }
  }
});

/** Kiểm baseline giữ chính xác Decimal và không coi hoàn tác hay thêm rồi xóa là bổ sung
 * ID minh chứng được sắp ổn định, thay thứ tự truy vấn không tạo thay đổi giả
 */
test("so baseline nhận thay đổi nội dung cuối và loại trừ thao tác hoàn tác", () => {
  const score = { selfScore: new Prisma.Decimal("8.00"), selfNote: "Diễn giải ban đầu", adminScore: new Prisma.Decimal(6), adminComment: "Thiếu minh chứng", reviewedAt: new Date(), reviewedById: "admin", evidences: [{ id: "b" }, { id: "a" }] } as CriterionScore & { evidences: Evidence[] };
  score.supplementBaseline = captureSupplementBaseline(score, new Date()) as Prisma.JsonObject;
  assert.equal(supplementChanged(score), false);
  score.selfScore = new Prisma.Decimal(9); assert.equal(supplementChanged(score), true);
  score.selfScore = new Prisma.Decimal(8); assert.equal(supplementChanged(score), false);
  score.selfNote = "Đã bổ sung"; assert.equal(supplementChanged(score), true);
  score.selfNote = "Diễn giải ban đầu";
  score.evidences.push({ id: "c" } as Evidence); assert.equal(supplementChanged(score), true);
  score.evidences.pop(); score.evidences.reverse(); assert.equal(supplementChanged(score), false);
  score.selfScore = null; assert.equal(supplementChanged(score), true);
});
