import apiClient from "./apiClient";

export const userService = {
  /** Lấy danh sách theo bộ lọc VC04; q được backend xử lý và trả tổng số dòng */
  getUsers: (params) => apiClient.get("/users", { params }),
  /** Tạo tài khoản và nhận mật khẩu tạm một lần để ADMIN bàn giao thủ công */
  createUser: (data) => apiClient.post("/users", data),
  /** Chỉ gửi các trường hồ sơ được phép, không gửi trạng thái qua route này */
  updateUser: (id, data) => apiClient.patch(`/users/${id}`, data),
  /** Khóa hoặc mở tài khoản qua route riêng để backend thu hồi phiên cũ */
  toggleUserStatus: (id, isActive) => apiClient.patch(`/users/${id}/status`, { isActive }),
  /** Đặt lại mật khẩu và chỉ nhận mật khẩu tạm ở phản hồi hiện tại */
  resetPassword: (id) => apiClient.post(`/users/${id}/reset-password`),
};
