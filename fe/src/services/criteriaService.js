import apiClient from "./apiClient";

export const criteriaService = {
  /** Lấy cây tiêu chí của kỳ, quyền hiển thị trước giờ mở do backend quyết định
   * periodId là UUID kỳ và params là tùy chọn dự phòng cho bộ lọc API
   * UI không so sánh giờ máy với lịch để mở nội dung
   */
  getCriteria: (periodId, params) => {
    return apiClient.get(`/evaluation-periods/${periodId}/criteria`, { params });
  },

  /** Tạo tiêu chí nháp trong kỳ được chọn
   * periodId nằm trong route còn data chỉ chứa nội dung tiêu chí
   * API khóa thao tác nếu kỳ đã công bố
   */
  createCriteria: (periodId, data) => {
    return apiClient.post(`/evaluation-periods/${periodId}/criteria`, data);
  },

  /** Sửa tiêu chí nháp sau khi Admin chọn bản ghi cần chỉnh
   * criterionId là UUID tiêu chí và data gồm field được phép cập nhật
   * Máy chủ kiểm tra kỳ chưa công bố và lưu audit
   */
  updateCriteria: (periodId, criterionId, data) => apiClient.patch(`/evaluation-periods/${periodId}/criteria/${criterionId}`, data),

  /** Xóa tiêu chí nháp nếu chưa có tiêu chí con hoặc điểm phụ thuộc
   * periodId và criterionId xác định chính xác kỳ cùng tiêu chí
   * Lỗi quan hệ được chuẩn hóa thành thông điệp tiếng Việt của API
   */
  deleteCriteria: (periodId, criterionId) => apiClient.delete(`/evaluation-periods/${periodId}/criteria/${criterionId}`),
};
