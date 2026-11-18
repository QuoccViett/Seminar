import { Prisma, type Criterion, type CriterionScore, type Evaluation, type EvaluationPeriod, type RatingThreshold } from "../../generated/prisma/client.js";

/** Quyết định khả năng sửa một lá từ snapshot đã khóa và thời gian máy chủ
 * UNIT chỉ sửa INITIAL trong DRAFT hoặc lá được yêu cầu của vòng bổ sung đang mở
 * Trạng thái kỳ tiến xa không thể mở lại quyền chỉ bằng thay đổi timestamp
 * Trả null khi hợp lệ, câu tiếng Việt khi khóa để API và FE cùng giải thích lý do
 */
export function selfLockedReason(period: EvaluationPeriod, evaluation: Evaluation, now: Date, needsSupplement = false): string | null {
  if (!period.publishedAt) return "Kỳ đánh giá chưa được công bố";
  if (evaluation.status === "DRAFT") {
    if (!["SETUP", "SELF_EVAL"].includes(period.phase)) return "Kỳ đánh giá đã chuyển sang thẩm định";
    if (!period.selfEvalStart || !period.selfEvalDeadline) return "Kỳ đánh giá chưa có lịch tự chấm hợp lệ";
    if (now < period.selfEvalStart) return "Chưa đến giờ mở tự chấm";
    if (now >= period.selfEvalDeadline) return "Đã hết thời gian tự chấm";
    return null;
  }
  if (evaluation.status === "SUPPLEMENT_REQUESTED") {
    if (!["FIRST_REVIEW", "SUPPLEMENT"].includes(period.phase)) return "Kỳ đánh giá không còn trong giai đoạn bổ sung";
    if (!needsSupplement) return "Tiêu chí này không được yêu cầu bổ sung";
    if (!evaluation.supplementStartAt || !evaluation.supplementDeadline) return "Hồ sơ chưa có lịch bổ sung hợp lệ";
    if (now < evaluation.supplementStartAt) return "Chưa đến giờ mở bổ sung";
    if (now >= evaluation.supplementDeadline) return "Đã hết thời gian bổ sung";
    return null;
  }
  return evaluation.autoLockedAt ? "Đã hết thời gian tự chấm" : "Hồ sơ đã khóa chỉnh sửa";
}

/** Tính tổng tự chấm từ các lá bằng Decimal để tránh sai số cộng số thực
 * null được tính 0 nhưng scoredCount chỉ đếm điểm đã nhập, kể cả số 0
 * Xếp loại bằng so chéo tổng và ngưỡng chưa làm tròn, percent chỉ làm tròn khi hiển thị
 * Không đọc adminScore hoặc view currentTotal nên UNIT chưa chốt không suy ra điểm thẩm định
 */
export function selfSummary(evaluationId: string, maxTotalScore: Prisma.Decimal, leaves: Criterion[], scores: CriterionScore[], thresholds: RatingThreshold[]) {
  const leafIds = new Set(leaves.map((leaf) => leaf.id));
  const selected = scores.filter((score) => leafIds.has(score.criterionId));
  const total = selected.reduce((sum, score) => sum.add(score.selfScore ?? 0), new Prisma.Decimal(0));
  const threshold = [...thresholds].sort((a, b) => b.minPercent.comparedTo(a.minPercent)).find((item) => {
    const comparison = total.mul(100).comparedTo(item.minPercent.mul(maxTotalScore));
    return item.minExclusive ? comparison > 0 : comparison >= 0;
  });
  return {
    evaluationId, selfTotal: total.toNumber(), maxTotalScore: maxTotalScore.toNumber(),
    selfPercent: maxTotalScore.gt(0) ? total.mul(100).div(maxTotalScore).toDecimalPlaces(2).toNumber() : 0,
    suggestedRating: threshold?.rating ?? null, ratingLabel: threshold?.label ?? null, ratingColor: threshold?.color ?? null,
    scoredCount: selected.filter((score) => score.selfScore !== null).length, leafCount: leaves.length,
  };
}
