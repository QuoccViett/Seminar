import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import NotificationInbox from "./NotificationInbox";
import * as service from "../services/notificationService";

vi.mock("../services/notificationService", () => ({
  listNotifications: vi.fn(), getNotificationPreferences: vi.fn(), markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(), updateNotificationPreferences: vi.fn(), createTestNotification: vi.fn(),
}));

/** Dùng phản hồi có cùng shape API để kiểm giao diện xử lý dữ liệu thật và trạng thái ZNS tắt
 * Phép thử không thay bằng backend giả khi đánh giá tích hợp; HTTP PostgreSQL được kiểm ở test BE riêng
 */
beforeEach(() => {
  vi.clearAllMocks();
  service.listNotifications.mockResolvedValue({ items: [{ id: "notification-1", title: "Có việc mới", body: "Vui lòng xem hồ sơ", isRead: false, createdAt: "2026-11-17T00:00:00Z" }], page: 1, pageSize: 20, total: 1 });
  service.getNotificationPreferences.mockResolvedValue({ SYSTEM: true, WEB_PUSH: true, EMAIL: true, ZALO_ZNS: false, zaloZnsAvailable: false });
  service.markNotificationRead.mockResolvedValue({ isRead: true });
  service.markAllNotificationsRead.mockResolvedValue({ updated: 1 });
  service.updateNotificationPreferences.mockResolvedValue({ SYSTEM: true, WEB_PUSH: true, EMAIL: false, ZALO_ZNS: false, zaloZnsAvailable: false });
  service.createTestNotification.mockResolvedValue({ notificationId: "test-1", queuedChannels: [] });
});

/** Một bản ghi chưa đọc phải hiển thị nội dung, thao tác đọc gửi đúng ID và ZNS không có nút gửi */
test("hộp thư hiển thị thông báo thật và chặn thao tác ZNS khi tắt", async () => {
  render(<NotificationInbox />);
  expect(await screen.findByText("Có việc mới")).toBeInTheDocument();
  expect(screen.getByText("Vui lòng xem hồ sơ")).toBeInTheDocument();
  expect(screen.getByText("Chưa kích hoạt")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Zalo ZNS" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Đánh dấu đã đọc" }));
  await waitFor(() => expect(service.markNotificationRead).toHaveBeenCalledWith("notification-1"));
});
