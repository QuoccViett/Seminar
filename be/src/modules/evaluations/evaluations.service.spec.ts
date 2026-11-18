import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type Criterion, type CriterionScore, type Evaluation, type EvaluationPeriod, type RatingThreshold } from "../../generated/prisma/client.js";
import { selfLockedReason, selfSummary } from "./evaluation-policy.js";

/** Dựng snapshot chỉ cho pure policy, transaction và SQL được kiểm riêng bằng PostgreSQL thật
 * Mốc tự chấm rơi cuối tuần để bảo đảm không vô tình áp lịch ngày làm việc của bổ sung
 */
function fixture() {
  const start = new Date("2026-11-28T16:30:00Z");
  const deadline = new Date("2026-11-28T17:00:00Z");
  const period = { publishedAt: start, phase: "SETUP", selfEvalStart: start, selfEvalDeadline: deadline } as EvaluationPeriod;
  const evaluation = { status: "DRAFT", autoLockedAt: null } as Evaluation;
  return { start, deadline, period, evaluation };
}

/** Kiểm cửa sổ loại trừ deadline ở độ chính xác mili giây, không phụ thuộc phase job trễ
 * Đúng start cuối tuần được sửa, đúng deadline bị khóa, kỳ CLOSED không được mở lại
 */
test("quyền INITIAL mở đúng start và khóa đúng deadline mọi ngày giờ", () => {
  const { start, deadline, period, evaluation } = fixture();
  assert.ok(selfLockedReason(period, evaluation, new Date(+start - 1)));
  assert.equal(selfLockedReason(period, evaluation, start), null);
  assert.equal(selfLockedReason(period, evaluation, new Date(+deadline - 1)), null);
  assert.ok(selfLockedReason(period, evaluation, deadline));
  period.phase = "CLOSED";
  assert.ok(selfLockedReason(period, evaluation, start));
  period.phase = "SELF_EVAL"; period.publishedAt = null;
  assert.ok(selfLockedReason(period, evaluation, start));
});

/** Chỉ lá được yêu cầu được sửa trong snapshot bổ sung, không cộng supplementHours
 * Trước start, đúng deadline và nộp sớm đều khóa, lịch snapshot có thể ngắn vào thứ Sáu
 */
test("quyền bổ sung giới hạn lá và hai biên snapshot đã lưu", () => {
  const { start, deadline, period, evaluation } = fixture();
  period.phase = "SUPPLEMENT";
  Object.assign(evaluation, { status: "SUPPLEMENT_REQUESTED", supplementStartAt: start, supplementDeadline: deadline });
  assert.ok(selfLockedReason(period, evaluation, start, false));
  assert.ok(selfLockedReason(period, evaluation, new Date(+start - 1), true));
  assert.equal(selfLockedReason(period, evaluation, start, true), null);
  assert.ok(selfLockedReason(period, evaluation, deadline, true));
  evaluation.status = "SUPPLEMENT_SUBMITTED";
  assert.ok(selfLockedReason(period, evaluation, start, true));
});

/** Tính tổng Decimal từ lá, bỏ nhóm, null không đếm đã nhập còn 0 vẫn là điểm thật
 * adminScore cố ý khác xa selfScore để chứng minh summary không dùng tổng thẩm định
 * Các ngưỡng kiểm bằng tích chéo tránh làm tròn 85,001% xuống 85% rồi xếp sai
 */
test("summary dùng Decimal, giữ null/zero và biên EXCELLENT độc quyền", () => {
  const decimal = (value: number) => new Prisma.Decimal(value);
  const thresholds = [
    { rating: "EXCELLENT", label: "Xuất sắc", minPercent: decimal(85), minExclusive: true },
    { rating: "GOOD", label: "Tốt", minPercent: decimal(65), minExclusive: false },
    { rating: "PASS", label: "Đạt", minPercent: decimal(50), minExclusive: false },
    { rating: "FAIL", label: "Chưa đạt", minPercent: decimal(0), minExclusive: false },
  ] as RatingThreshold[];
  const leaves = [{ id: "a" }, { id: "b" }, { id: "c" }] as Criterion[];
  for (const [value, expected] of [[85, "GOOD"], [85.01, "EXCELLENT"], [65, "GOOD"], [50, "PASS"], [0, "FAIL"]] as const) {
    const scores = [{ criterionId: "a", selfScore: decimal(value), adminScore: decimal(1) }, { criterionId: "b", selfScore: decimal(0) }, { criterionId: "c", selfScore: null }, { criterionId: "group", selfScore: decimal(300) }] as CriterionScore[];
    const summary = selfSummary("evaluation", decimal(100), leaves, scores, thresholds);
    assert.equal(summary.selfTotal, value);
    assert.equal(summary.suggestedRating, expected);
    assert.equal(summary.scoredCount, 2);
    assert.equal(summary.leafCount, 3);
    assert.equal("currentTotal" in summary, false);
  }
  const precise = selfSummary("evaluation", decimal(1000), leaves, [{ criterionId: "a", selfScore: decimal(850.01) }] as CriterionScore[], thresholds);
  assert.equal(precise.selfPercent, 85);
  assert.equal(precise.suggestedRating, "EXCELLENT");
  assert.equal(selfSummary("evaluation", decimal(1), leaves, [{ criterionId: "a", selfScore: decimal(0.1) }, { criterionId: "b", selfScore: decimal(0.2) }] as CriterionScore[], thresholds).selfTotal, 0.3);
});
