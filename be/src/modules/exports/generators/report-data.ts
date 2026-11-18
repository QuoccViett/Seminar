/** Snapshot kỳ và ngưỡng tại lúc đọc, dùng chung cho ba generator để giữ nhãn và thời gian nhất quán
 * Số đã được tính bằng Decimal ở service, generator chỉ trình bày và không tính lại nghiệp vụ
 */
export interface ReportPeriodData {
  id: string; year: number; name: string; phase: string; maxTotalScore: number;
  generatedAt: Date; createdByName: string;
  thresholds: { rating: string; label: string; color: string | null; minPercent: number; minExclusive: boolean }[];
}

/** Một dòng cho mỗi hồ sơ thuộc kỳ, điểm chính thức để trống cho đến khi đã chốt
 * selfTotal và currentTotal bao gồm điểm không bằng null trên các lá, không cộng điểm nhóm
 */
export interface SummaryUnitRow {
  unitCode: string; unitName: string; evaluationStatus: string;
  submittedAt: Date | null; finalizedAt: Date | null;
  selfTotal: number; currentTotal: number;
  finalScore: number | null; finalPercent: number | null; finalRating: string | null;
  ratingLabel: string | null; ratingColor: string | null;
}

/** Bảng tổng hợp nhận trọn snapshot của kỳ, kể cả trường hợp chưa có hồ sơ */
export interface SummaryReportData { period: ReportPeriodData; rows: SummaryUnitRow[] }

/** Dòng nhóm chỉ mang tiêu đề, dòng lá mới có điểm và chi tiết thẩm định
 * Minh chứng chỉ mang tham chiếu công khai, không chứa key, URL ký hay bí mật storage
 */
export interface AppraisalScoreRow {
  code: string; name: string; depth: number; isGroup: boolean; maxScore: number;
  selfScore: number | null; adminScore: number | null; currentScore: number | null;
  selfNote: string | null; adminComment: string | null; reviewerName: string | null; reviewedAt: Date | null;
  evidences: { id: string; label: string; round: string }[];
  needsSupplement: boolean; supplementNote: string | null; supplementedAt: Date | null;
  baseline: { selfScore: string | null; adminScore: string | null; selfNote: string | null; adminComment: string | null; evidenceIds: string[] } | null;
}

/** Phản hồi và lịch sử giữ thứ tự thời gian/ID từ DB, tên người hệ thống được biểu diễn riêng */
export interface AppraisalFeedbackRow { type: string; content: string; authorName: string; createdAt: Date }
export interface AppraisalHistoryRow { fromStatus: string | null; toStatus: string; comment: string | null; actorName: string; createdAt: Date }

/** Biên bản gom các mốc bổ sung đã lưu và kết quả chính thức, không suy ra lịch từ supplementHours */
export interface AppraisalReportData {
  period: ReportPeriodData;
  evaluation: {
    id: string; status: string; submittedAt: Date | null; finalizedAt: Date | null;
    supplementRequestedAt: Date | null; supplementStartAt: Date | null; supplementDeadline: Date | null; supplementSubmittedAt: Date | null;
    finalScore: number | null; finalPercent: number | null; finalRating: string | null; finalRatingLabel: string | null;
    finalizedByName: string | null; selfTotal: number; currentTotal: number; currentPercent: number;
    currentRatingLabel: string | null;
  };
  unit: { code: string; name: string };
  scores: AppraisalScoreRow[]; feedbacks: AppraisalFeedbackRow[]; histories: AppraisalHistoryRow[];
}

/** Bytes hoàn chỉnh được lưu trước khi tạo metadata, định dạng MIME do generator xác định */
export interface GeneratedReport { buffer: Buffer; contentType: string; extension: string }

/** Định dạng ngày theo Việt Nam, null được biểu diễn rõ là chưa có mốc */
export function reportDate(value: Date | null): string {
  return value ? value.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }) : "Chưa có";
}

/** Nhãn tiếng Việt cho trạng thái kỹ thuật, giá trị lạ không được suy diễn thành đã hoàn tất */
export function reportStatus(value: string | null): string {
  return ({ DRAFT: "Đang tự chấm", PENDING_REVIEW: "Chờ thẩm định", SUPPLEMENT_REQUESTED: "Yêu cầu bổ sung", SUPPLEMENT_SUBMITTED: "Đã nộp bổ sung", SUPPLEMENT_EXPIRED: "Hết hạn bổ sung", FINALIZED: "Đã chốt" } as Record<string, string>)[value ?? ""] ?? "Chưa xác định";
}

/** Chuẩn hóa số để trình bày trong văn bản, giữ null khác với điểm không */
export function reportValue(value: number | string | null): string { return value === null ? "Chưa có" : String(value); }

/** Tạo các dòng diễn giải chi tiết cho một tiêu chí lá để PDF và Word không bỏ sót nội dung
 * Có baseline thì hiển thị điểm trước bổ sung, không đưa JSON thô hoặc đường dẫn minh chứng vào tệp
 */
export function scoreDetails(score: AppraisalScoreRow): string[] {
  if (score.isGroup) return [];
  return [
    `Diễn giải tự chấm: ${score.selfNote ?? "Chưa có"}`,
    `Lý do/nhận xét thẩm định: ${score.adminComment ?? "Chưa có"}`,
    `Người thẩm định: ${score.reviewerName ?? "Chưa có"} — ${reportDate(score.reviewedAt)}`,
    ...score.evidences.map((item) => `Minh chứng [${item.id}] (${item.round === "SUPPLEMENT" ? "Bổ sung" : "Ban đầu"}): ${item.label}`),
    ...(score.evidences.length ? [] : ["Minh chứng: Chưa có"]),
    `Yêu cầu bổ sung: ${score.supplementNote ?? (score.needsSupplement ? "Có yêu cầu" : "Không có")}`,
    `Thời điểm cập nhật bổ sung: ${reportDate(score.supplementedAt)}`,
    ...(score.baseline ? [`Trước bổ sung — tự chấm: ${reportValue(score.baseline.selfScore)}; thẩm định: ${reportValue(score.baseline.adminScore)}; diễn giải: ${score.baseline.selfNote ?? "Chưa có"}`,
      `Lý do trước bổ sung: ${score.baseline.adminComment ?? "Chưa có"}; Minh chứng trước bổ sung: ${score.baseline.evidenceIds.join(", ") || "Chưa có"}`] : []),
  ];
}

/** Dựng phần đầu và cuối của biên bản từ snapshot để hai định dạng có cùng thông tin
 * Trước chốt luôn gắn nhãn dự thảo, sau chốt dùng kết quả bất biến thay cho tổng tạm tính
 */
export function appraisalSections(data: AppraisalReportData) {
  const e = data.evaluation;
  const final = e.status === "FINALIZED";
  return {
    heading: [
      final ? "KẾT QUẢ ĐÃ CHỐT" : "CHƯA CHỐT — TẠM TÍNH",
      `Kỳ đánh giá: ${data.period.name} (${data.period.year})`,
      `Đơn vị: ${data.unit.code} — ${data.unit.name}`,
      `Lập lúc: ${reportDate(data.period.generatedAt)} (giờ Việt Nam) — Người xuất: ${data.period.createdByName}`,
      `Trạng thái: ${reportStatus(e.status)} — Ngày nộp: ${reportDate(e.submittedAt)}`,
    ],
    conclusion: [
      `Điểm tối đa: ${data.period.maxTotalScore}; Tổng tự chấm: ${e.selfTotal}; Tổng thẩm định hiện tại (tạm tính): ${e.currentTotal}`,
      `Tỷ lệ hiện tại (tạm tính): ${e.currentPercent}%; Xếp loại dự kiến: ${e.currentRatingLabel ?? "Chưa có"}`,
      `Điểm chính thức: ${reportValue(e.finalScore)}; Tỷ lệ chính thức: ${reportValue(e.finalPercent)}%; Xếp loại chính thức: ${e.finalRatingLabel ?? "Chưa có"}`,
      `Người chốt: ${e.finalizedByName ?? "Chưa có"}; Thời điểm chốt: ${reportDate(e.finalizedAt)}`,
      `Yêu cầu bổ sung lúc: ${reportDate(e.supplementRequestedAt)}`,
      `Cửa sổ bổ sung: [${reportDate(e.supplementStartAt)}, ${reportDate(e.supplementDeadline)}) — Mốc kết thúc loại trừ`,
      `Nộp bổ sung lúc: ${reportDate(e.supplementSubmittedAt)}`,
      "Lịch bổ sung là snapshot đã lưu theo phương án tạm, chờ giảng viên xác nhận",
    ],
  };
}
