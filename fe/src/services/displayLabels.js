export const ROLE_LABELS = { ADMIN: "Quản trị viên", UNIT: "Đơn vị tự chấm", SYSTEM: "Hệ thống" };
export const EVALUATION_STATUS_LABELS = { DRAFT: "Đang tự chấm", SUBMITTED: "Đã nộp hồ sơ", IN_REVIEW: "Đang thẩm định", PENDING_REVIEW: "Chờ duyệt", NEEDS_SUPPLEMENT: "Được yêu cầu bổ sung", SUPPLEMENT_REQUESTED: "Được yêu cầu bổ sung", SUPPLEMENT_SUBMITTED: "Đã nộp bổ sung", SUPPLEMENT_EXPIRED: "Đã hết hạn bổ sung", FINALIZED: "Đã chốt" };
export const PHASE_LABELS = { SETUP: "Thiết lập", SELF_EVAL: "Tự chấm", FIRST_REVIEW: "Thẩm định lần đầu", SUPPLEMENT: "Bổ sung", FINAL_REVIEW: "Thẩm định cuối", CLOSED: "Đã đóng" };
export const RATING_LABELS = { EXCELLENT: "Xuất sắc", GOOD: "Tốt", PASS: "Đạt", FAIL: "Chưa đạt" };
export const UNIT_TYPE_LABELS = { CONG_AN_QUAN_HUYEN: "Công an quận/huyện", PHONG_NGHIEP_VU: "Phòng nghiệp vụ", DON_VI_TRUC_THUOC: "Đơn vị trực thuộc" };
export const CHANNEL_LABELS = { SYSTEM: "Hộp thư hệ thống", WEB_PUSH: "Thông báo trình duyệt", EMAIL: "Email", ZALO_ZNS: "Zalo ZNS" };
export const FEEDBACK_TYPE_LABELS = { GENERAL: "Nhận xét chung", EXPLANATION_REQUEST: "Yêu cầu giải trình", UNIT_REPLY: "Đơn vị phản hồi", SUPPLEMENT_REQUEST: "Yêu cầu bổ sung" };
export const DELIVERY_STATUS_LABELS = { PENDING: "Đang chờ xử lý", QUEUED: "Đã xếp hàng", SENT: "Nhà cung cấp đã tiếp nhận", FAILED: "Gửi thất bại", SKIPPED: "Đã bỏ qua", NOT_CONFIGURED: "Chưa cấu hình" };
export const DELIVERY_REASON_LABELS = {
  EMAIL_UNCONFIRMED: "Chưa xác nhận địa chỉ email nhận thông tin đăng nhập",
  NO_SUBSCRIPTION: "Chưa đăng ký thiết bị nhận thông báo",
  CREDENTIAL_CHANGED: "Thông tin đăng nhập đã thay đổi; lượt gửi cũ đã bị hủy",
  EXPIRED: "Đã hết thời hạn gửi", KEY_UNAVAILABLE: "Không thể giải mã thông tin cấp tài khoản; cần kiểm tra cấu hình",
  PROVIDER_NOT_READY: "Kênh gửi chưa được bật hoặc cấu hình đầy đủ",
  RECIPIENT_MISSING: "Người nhận chưa có địa chỉ hoặc thiết bị phù hợp",
  RATE_LIMIT: "Kênh gửi đang giới hạn lượt gửi",
  TEMPORARY_FAILURE: "Kênh gửi tạm thời gián đoạn",
  PERMANENT_FAILURE: "Không thể gửi qua kênh này; cần kiểm tra người nhận và cấu hình",
  PROVIDER_ERROR: "Không thể gửi qua kênh này",
};
export const FIELD_LABELS = {
  unitCode: "Mã đơn vị", unitName: "Tên đơn vị", unitType: "Loại đơn vị", username: "Tên đăng nhập", fullName: "Họ và tên", email: "Email", phone: "Số điện thoại",
  role: "Vai trò", unitId: "Mã đơn vị", userId: "Mã tài khoản", periodId: "Mã kỳ đánh giá", criterionId: "Mã tiêu chí", evaluationId: "Mã hồ sơ",
  selfEvalStart: "Ngày giờ mở tự chấm", selfEvalDeadline: "Hạn tự chấm", supplementStartAt: "Ngày giờ mở bổ sung", supplementDeadline: "Hạn bổ sung",
  selfScore: "Điểm tự chấm", selfNote: "Diễn giải tự chấm", adminScore: "Điểm thẩm định", adminComment: "Nhận xét thẩm định", maxScore: "Điểm tối đa", maxTotalScore: "Tổng điểm tối đa",
  currentPassword: "Mật khẩu hiện tại", newPassword: "Mật khẩu mới", confirmPassword: "Xác nhận mật khẩu", password: "Mật khẩu",
  minPercent: "Ngưỡng phần trăm", minExclusive: "Loại trừ ngưỡng", rating: "Mức xếp loại", ratingThresholds: "Các ngưỡng xếp loại", thresholds: "Các ngưỡng xếp loại",
  parentId: "Tiêu chí cha", sortOrder: "Thứ tự", allowText: "Cho phép diễn giải", allowFile: "Cho phép tệp", allowLink: "Cho phép liên kết", evidenceRequired: "Bắt buộc minh chứng",
  channel: "Kênh thông báo", content: "Nội dung", changeReason: "Lý do thay đổi", name: "Tên", label: "Tên hiển thị", color: "Màu", year: "Năm",
  page: "Trang", pageSize: "Số dòng mỗi trang", isRead: "Trạng thái đã đọc", isActive: "Trạng thái hoạt động", fileName: "Tên tệp", sizeBytes: "Dung lượng tệp", mimeType: "Định dạng tệp",
  reportType: "Loại báo cáo", evaluationIds: "Danh sách hồ sơ", items: "Danh sách", rows: "Dòng dữ liệu", note: "Ghi chú", type: "Loại", id: "Mã bản ghi",
};

/** Nhãn dự phòng luôn có nghĩa với người dùng, không lấy mã API làm nội dung hiển thị */
export function displayLabel(labels, value, fallback = "Chưa xác định") { return Object.hasOwn(labels, value) ? labels[value] : fallback; }

/** Ưu tiên nhãn tùy chỉnh của kỳ; dữ liệu cũ trả mã rating vẫn có tên mặc định dễ hiểu */
export function ratingLabel(rating, label, thresholds = []) {
  const selected = label || thresholds.find((item) => item.rating === rating)?.label;
  return selected ? displayLabel(RATING_LABELS, selected, /^[A-Z][A-Z0-9_]*$/u.test(selected) ? "Chưa có xếp loại" : selected) : displayLabel(RATING_LABELS, rating, "Chưa có xếp loại");
}

const messageTokens = { ...FIELD_LABELS, ...ROLE_LABELS, ...EVALUATION_STATUS_LABELS, ...PHASE_LABELS, ...RATING_LABELS, ...UNIT_TYPE_LABELS, ...CHANNEL_LABELS, ...DELIVERY_STATUS_LABELS, ...DELIVERY_REASON_LABELS, ...FEEDBACK_TYPE_LABELS };
const tokenPattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${Object.keys(messageTokens).sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}\\p{N}_])`, "gu");

/** Chỉ dùng cho thông báo hệ thống; không đổi nội dung người dùng, mã đơn vị, tên đăng nhập hoặc tiêu chí
 * Câu tiếng Việt có tên field/enum được dịch tại biên hiển thị, định danh API vẫn giữ nguyên để form gắn lỗi
 */
export function systemMessage(value, fallback = "Không thể hoàn tất thao tác, vui lòng thử lại") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  if (Object.hasOwn(messageTokens, value)) return messageTokens[value];
  if (!/[À-ỹ]/u.test(value) || /Prisma|SQLSTATE|SELECT\s|INSERT\s|passwordHash|stack\s*trace/i.test(value)) return fallback;
  return value.replace(tokenPattern, (token) => messageTokens[token]);
}

/** Không phản chiếu lỗi SMTP/provider thô hoặc mã chưa biết; chỉ hiện câu an toàn và lý do đã định nghĩa */
export function deliveryDescription(delivery) {
  const status = displayLabel(DELIVERY_STATUS_LABELS, delivery?.status, "Chưa xếp hàng");
  const reasonCode = delivery?.errorCode ?? delivery?.reasonCode;
  const reason = reasonCode ? displayLabel(DELIVERY_REASON_LABELS, reasonCode, "Cần kiểm tra lại kênh gửi") : delivery?.lastError ? systemMessage(delivery.lastError, "Cần kiểm tra lại kênh gửi") : "";
  return reason ? `${status} · ${reason}` : status;
}

/** Chỉ đổi hậu tố trạng thái của thông báo seed cũ, không dịch tên đăng nhập hoặc nội dung tự nhập */
export function notificationBody(notification) {
  const body = notification.body ?? "";
  if (notification.type !== "EVALUATION_STATUS_CHANGED") return body;
  return body.replace(/^(Hồ sơ của .+ đang ở trạng thái )([A-Z_]+)(\.)$/u, (_, prefix, status, suffix) => `${prefix}${displayLabel(EVALUATION_STATUS_LABELS, status, "chưa xác định")}${suffix}`);
}
