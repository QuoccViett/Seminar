import { Prisma, type CriterionScore, type Evaluation, type EvaluationPeriod, type Evidence } from "../../generated/prisma/client.js";

/** Chụp nội dung và thẩm định trước vòng bổ sung từ score đã khóa cùng các minh chứng
 * Chỉ lưu metadata công khai và ID bất biến của minh chứng đã xác nhận, không lưu storagePath
 * Điểm dùng chuỗi Decimal để giữ chính xác, mốc chụp do DB cấp và không lấy từ client
 */
export function captureSupplementBaseline(score: CriterionScore & { evidences: Evidence[] }, now: Date): Prisma.InputJsonObject {
  return {
    content: { selfScore: score.selfScore?.toString() ?? null, selfNote: score.selfNote, evidenceIds: score.evidences.map((item) => item.id).sort() },
    review: { adminScore: score.adminScore?.toString() ?? null, adminComment: score.adminComment, reviewedById: score.reviewedById, reviewedAt: score.reviewedAt?.toISOString() ?? null },
    capturedAt: now.toISOString(), source: "REQUEST",
  };
}

/** So nội dung cuối với baseline thay vì chỉ nhìn mốc thao tác supplementedAt
 * Điểm 0 khác null, Decimal tương đương không bị coi là thay đổi vì định dạng chuỗi
 * Tập ID chứng minh file/link còn tồn tại; thêm rồi xóa hoặc sửa rồi hoàn tác đều trả false
 */
export function supplementChanged(score: Pick<CriterionScore, "selfScore" | "selfNote" | "supplementBaseline"> & { evidences: Pick<Evidence, "id">[] }): boolean {
  const baseline = score.supplementBaseline as { content?: { selfScore?: string | number | null; selfNote?: string | null; evidenceIds?: string[] } } | null;
  if (!baseline?.content || !Array.isArray(baseline.content.evidenceIds)) return false;
  const previous = baseline.content.selfScore == null ? null : new Prisma.Decimal(baseline.content.selfScore).toString();
  return previous !== (score.selfScore?.toString() ?? null) || (baseline.content.selfNote ?? null) !== score.selfNote
    || JSON.stringify([...baseline.content.evidenceIds].sort()) !== JSON.stringify(score.evidences.map((item) => item.id).sort());
}

/** Tính quyền trình bày của Admin từ trạng thái hiệu lực tại giờ server
 * Yêu cầu hết hạn được coi là đã đóng để không khóa thao tác khi scheduler chạy chậm
 * Đây là snapshot giao diện, các use-case ghi vẫn khóa và kiểm lại trước cập nhật
 */
export function reviewPermissions(period: EvaluationPeriod, evaluation: Evaluation, now: Date) {
  const expired = evaluation.status === "SUPPLEMENT_REQUESTED" && evaluation.supplementDeadline !== null && now >= evaluation.supplementDeadline;
  const ready = ["PENDING_REVIEW", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"].includes(evaluation.status) || expired;
  const reviewPhase = ["FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW"].includes(period.phase);
  return {
    canReview: Boolean(period.publishedAt) && reviewPhase && ready,
    canCompleteFirstReview: ["FIRST_REVIEW", "SUPPLEMENT"].includes(period.phase) && evaluation.status === "PENDING_REVIEW" && !evaluation.firstReviewedAt,
    canRequestSupplement: ["FIRST_REVIEW", "SUPPLEMENT"].includes(period.phase) && evaluation.status === "PENDING_REVIEW" && Boolean(evaluation.firstReviewedAt) && !evaluation.supplementRequestedAt,
    canFinalize: period.phase === "FINAL_REVIEW" && Boolean(evaluation.firstReviewedAt) && ready,
  };
}
