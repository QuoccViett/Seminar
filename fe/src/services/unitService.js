import apiClient from "./apiClient";

export const unitService = {
  /** Lấy đơn vị theo trang, q và bộ lọc do backend áp dụng */
  getUnits: (params) => apiClient.get("/units", { params }),
  /** Lấy chi tiết đơn vị; UNIT chỉ đọc được đơn vị gắn với tài khoản hiện tại */
  getUnit: (id) => apiClient.get(`/units/${id}`),
  /** Lấy danh sách tài khoản an toàn thuộc một đơn vị theo quyền backend */
  getUnitUsers: (id) => apiClient.get(`/units/${id}/users`),
  /** Tạo đơn vị, backend kiểm loại đơn vị theo ràng buộc cơ sở dữ liệu */
  createUnit: (data) => apiClient.post("/units", data),
  /** Cập nhật hồ sơ hoặc trạng thái đơn vị mà vẫn giữ lịch sử đánh giá */
  updateUnit: (id, data) => apiClient.patch(`/units/${id}`, data),
};
