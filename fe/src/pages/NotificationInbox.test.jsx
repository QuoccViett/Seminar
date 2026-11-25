import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Modal } from "antd";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import NotificationInbox from "./NotificationInbox";
import * as service from "../services/notificationService";

vi.mock("../services/notificationService", () => ({
  listNotifications: vi.fn(), getNotificationPreferences: vi.fn(), markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(), updateNotificationPreferences: vi.fn(), createTestNotification: vi.fn(), getNotificationDeliveries: vi.fn(),
}));

afterEach(() => { Modal.destroyAll(); cleanup(); });

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

test("không hiển thị kênh chưa cấu hình trên máy chủ là đang bật", async () => {
  service.getNotificationPreferences.mockResolvedValue({ SYSTEM: true, WEB_PUSH: true, EMAIL: true, ZALO_ZNS: false, zaloZnsAvailable: false, webPushAvailable: false, emailAvailable: false });
  render(<NotificationInbox />);
  await screen.findByText("Có việc mới");
  expect(screen.getByRole("switch", { name: "Thông báo trình duyệt" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Thông báo trình duyệt" })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: "Email" })).toBeDisabled();
  expect(screen.getAllByText("Chưa kích hoạt trên máy chủ")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Đăng ký thiết bị này" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Thử kênh" })).toBeNull();
});

/** Trạng thái kênh và lý do thất bại không được lộ enum hoặc lỗi SMTP thô trong modal */
test("hộp thư hiển thị tên kênh và lý do gửi bằng tiếng Việt", async () => {
  service.getNotificationDeliveries.mockResolvedValue({ channels: [{ channel: "WEB_PUSH", status: "SKIPPED", reasonCode: "RECIPIENT_MISSING" }, { channel: "EMAIL", status: "FAILED", reasonCode: "PROVIDER_ERROR", lastError: "SMTP stack trace" }] });
  render(<NotificationInbox />);
  fireEvent.click(await screen.findByRole("button", { name: "Trạng thái gửi" }));
  await screen.findByText("Thông báo trình duyệt: Đã bỏ qua · Người nhận chưa có địa chỉ hoặc thiết bị phù hợp");
  expect(screen.getByText("Email: Gửi thất bại · Không thể gửi qua kênh này")).toBeInTheDocument();
  expect(screen.queryByText(/WEB_PUSH|RECIPIENT_MISSING|PROVIDER_ERROR|SMTP stack trace/u)).toBeNull();
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
