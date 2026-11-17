import apiClient from "./apiClient";

/** Tải trang hộp thư của phiên hiện tại; backend tự ràng buộc userId từ access token
 * Tham số chỉ gồm phân trang và trạng thái đọc để giao diện không tự quyết định quyền
 */
export const listNotifications = (params) => apiClient.get("/notifications", { params });

/** Tải số chưa đọc riêng để chuông cập nhật mà không phải tải nội dung từng thông báo */
export const getUnreadCount = () => apiClient.get("/notifications/unread-count");

/** Đánh dấu một thông báo theo ID; backend trả 404 cả khi ID thuộc tài khoản khác */
export const markNotificationRead = (id) => apiClient.patch(`/notifications/${id}/read`);

/** Đánh dấu toàn bộ hộp thư của phiên hiện tại và trả số dòng đã đổi thật */
export const markAllNotificationsRead = () => apiClient.post("/notifications/read-all");

/** Đọc ba kênh tùy chọn và trạng thái kích hoạt ZNS từ cấu hình backend */
export const getNotificationPreferences = () => apiClient.get("/notifications/preferences");

/** Gửi đúng các kênh được sửa; SYSTEM không xuất hiện trong body vì luôn bật */
export const updateNotificationPreferences = (changes) => apiClient.patch("/notifications/preferences", changes);

/** Tạo thông báo kiểm tra cho tài khoản đang đăng nhập; kết quả chỉ xác nhận đã xếp hàng */
export const createTestNotification = (channel) => apiClient.post("/notifications/test", { channel });

/** Đọc trạng thái provider của thông báo thuộc phiên hiện tại sau khi đã xếp hàng */
export const getNotificationDeliveries = (id) => apiClient.get(`/notifications/${id}/deliveries`);
