import apiClient from "./apiClient";

export const userService = {
  /** Lấy danh sách theo bộ lọc VC04; q được backend xử lý và trả tổng số dòng */
  getUsers: (params) => apiClient.get("/users", { params }),
  /** Lấy hồ sơ tài khoản theo ID; UNIT chỉ đọc được hồ sơ của chính mình */
  getUser: (id) => apiClient.get(`/users/${id}`),
  /** Tạo tài khoản và nhận mật khẩu tạm một lần để ADMIN bàn giao thủ công */
  createUser: (data) => apiClient.post("/users", data),
  /** Chỉ gửi các trường hồ sơ được phép, không gửi trạng thái qua route này */
  updateUser: (id, data) => apiClient.patch(`/users/${id}`, data),
  /** Khóa hoặc mở tài khoản qua route riêng để backend thu hồi phiên cũ */
  toggleUserStatus: (id, isActive) => apiClient.patch(`/users/${id}/status`, { isActive }),
  /** Đặt lại mật khẩu và chỉ nhận mật khẩu tạm ở phản hồi hiện tại */
  resetPassword: (id) => apiClient.post(`/users/${id}/reset-password`),
  /** Đọc trạng thái giao credential của lượt cấp mới nhất mà không nhận payload bí mật */
  getCredentialStatus: (id) => apiClient.get(`/users/${id}/credential-deliveries`),
  /** Admin xác nhận đã kiểm tra email hiện tại trước khi worker được gửi mật khẩu */
  confirmCredentialEmail: (id, email) => apiClient.post(`/users/${id}/credential-deliveries/confirm-email`, { email }),
  /** Yêu cầu worker thử lại duy nhất một delivery lỗi; backend kiểm tra consent, TTL và payload mã hóa */
  retryCredentialDelivery: (id, channel) => apiClient.post(`/users/${id}/credential-deliveries/retry`, { channel }),
  /** Tải byte XLSX từ route quản trị để parser và giao diện dùng cùng header/định dạng mẫu
   * Đầu vào không có; axios trả response blob cho component tạo thao tác tải xuống
   */
  downloadImportTemplate: () => apiClient.get("/users/import/template", { responseType: "blob" }),
  /** Gửi tệp XLSX multipart cùng Idempotency-Key ổn định qua retry mạng
   * Đầu vào là File và key do component giữ trong state; đầu ra là preview đã phân tích ở backend
   * Không chuyển rows tự dựng từ FE và không gọi API confirm trong bước upload
   */
  previewImport: (file, idempotencyKey) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.post("/users/import/preview", form, { headers: { "Content-Type": "multipart/form-data", "Idempotency-Key": idempotencyKey } });
  },
  /** Xác nhận ImportSession server đã trả về sau khi Admin xem các dòng và lỗi
   * Chỉ truyền ID phiên; backend đọc lại rows đã lưu, kiểm DB trong transaction và trả kết quả delivery
   * Client không thể đổi nội dung hàng giữa bước preview và confirm
   */
  confirmImport: (importId) => apiClient.post(`/users/import/${importId}/confirm`, {}),
};
