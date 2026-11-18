import apiClient from "./apiClient";

export const evaluationPeriodService = {
  /** Đọc các cạnh chuyển giai đoạn và lý do khóa do backend tính lại
   * periodId là UUID kỳ, kết quả chỉ phục vụ hiển thị và được POST kiểm lại sau khóa
   */
  getPhaseOptions: (periodId) => apiClient.get(`/evaluation-periods/${periodId}/phase-options`),

  /** Yêu cầu chuyển tới một giai đoạn cụ thể và nhận kết quả đã commit
   * Backend kiểm đồ thị, giờ và hồ sơ, không cho FE tự cấp phase hoặc finalizedAt
   */
  transitionPhase: (periodId, phase) => apiClient.post(`/evaluation-periods/${periodId}/transition-phase`, { phase }),

  /** Xin xem trước lịch bổ sung tạm từ mốc mở có offset rõ ràng
   * Không tạo yêu cầu, hạn hiển thị do backend trả và không cộng supplementHours trên FE
   */
  previewSupplementSchedule: (supplementStartAt) => apiClient.post("/evaluation-periods/supplement-schedule/preview", { supplementStartAt }),
  /** Lấy danh sách kỳ để Admin cấu hình hoặc UNIT xem kỳ được mở theo quyền backend
   * params là bộ lọc và phân trang tùy chọn
   * FE chỉ hiển thị dữ liệu máy chủ trả về, không tự tính quyền theo đồng hồ thiết bị
   */
  getEvaluationPeriods: (params) => {
    return apiClient.get("/evaluation-periods", { params });
  },

  /** Tạo kỳ mới ở trạng thái nháp do backend khởi tạo
   * data chứa năm, tên, tổng điểm và mốc tự chấm đã chọn
   * phase và publishedAt không do client quyết định
   */
  createEvaluationPeriod: (data) => {
    return apiClient.post("/evaluation-periods", data);
  },

  /** Lưu cấu hình kỳ nháp hoặc đổi lịch đã công bố trước giờ mở
   * periodId là UUID kỳ còn data là các field đã chỉnh cùng changeReason nếu cần
   * Backend xác thực trạng thái và lưu audit trước/sau
   */
  updateEvaluationPeriod: (periodId, data) => apiClient.patch(`/evaluation-periods/${periodId}`, data),

  /** Công bố cấu hình đã đủ lịch, tiêu chí và ngưỡng
   * periodId là UUID kỳ cần công bố
   * Máy chủ tự gắn thời điểm công bố rồi trả kỳ được cập nhật
   */
  publishEvaluationPeriod: (periodId) => apiClient.post(`/evaluation-periods/${periodId}/publish`),

  /** Đọc checklist công bố do backend tính từ cấu hình đang lưu
   * periodId là UUID kỳ cần kiểm tra
   * Kết quả chỉ hướng dẫn Admin; quyền công bố vẫn được xác thực lại khi gửi lệnh
   */
  getPublishCheck: (periodId) => apiClient.get(`/evaluation-periods/${periodId}/publish-check`),

  /** Đọc riêng bộ ngưỡng, dữ liệu trước giờ mở được backend ẩn với UNIT
   * periodId là UUID kỳ đánh giá
   * FE không so sánh giờ hiện tại để quyết định có hiển thị kết quả hay không
   */
  getThresholds: (periodId) => apiClient.get(`/evaluation-periods/${periodId}/thresholds`),

  /** Lưu đồng bộ trọn bộ bốn ngưỡng xếp loại trước khi công bố
   * periodId là UUID kỳ còn thresholds là mảng mức xếp loại chuẩn
   * Backend khóa thay đổi sau công bố và ghi nhận audit
   */
  saveThresholds: (periodId, thresholds) => apiClient.put(`/evaluation-periods/${periodId}/thresholds`, thresholds),
};
