import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import AdminAuditLog from "./AdminAuditLog";
import { auditLogService } from "../../services/auditLogService";

vi.mock("../../services/auditLogService", () => ({ auditLogService: { getAuditLogs: vi.fn(), getAuditLog: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

/** Kiểm lọc ID/hành động và modal snapshot, service HTTP được nghiệm thu riêng trên DB thật */
test("audit gửi bộ lọc chuẩn và hiển thị trước sau", async () => {
  auditLogService.getAuditLogs.mockResolvedValue({ items: [{ id: "audit", actorName: "Người duyệt", action: "REVIEW_SCORE", entity: "CriterionScore", entityId: "score", createdAt: "2026-11-18T00:00:00Z" }], total: 1 });
  auditLogService.getAuditLog.mockResolvedValue({ id: "audit", actorName: "Người duyệt", action: "REVIEW_SCORE", entity: "CriterionScore", entityId: "score", createdAt: "2026-11-18T00:00:00Z", before: { adminScore: 8 }, after: { adminScore: 6, adminComment: "Thiếu nội dung" } });
  render(<AdminAuditLog />);
  const action = screen.getByRole("combobox", { name: "Hành động" });
  fireEvent.mouseDown(action); fireEvent.change(action, { target: { value: "Thẩm định điểm" } });
  fireEvent.click(await screen.findByText("Thẩm định điểm", { selector: ".ant-select-item-option-content" }));
  fireEvent.click(screen.getByText("Lọc nhật ký"));
  await waitFor(() => expect(auditLogService.getAuditLogs).toHaveBeenLastCalledWith({ action: "REVIEW_SCORE", page: 1, pageSize: 20 }));
  fireEvent.click(await screen.findByText("Xem thay đổi")); await screen.findByText("Trước thay đổi"); expect(await screen.findByText(/Thiếu nội dung/)).toBeInTheDocument();
});

/** Snapshot dịch metadata nhưng không được thay mã đơn vị, tên đăng nhập hoặc ghi chú tự nhập */
test("audit dịch trường và enum còn sót, giữ nguyên dữ liệu nghiệp vụ", async () => {
  const row = { id: "audit", actorName: "Hệ thống", action: "NOTIFICATION_DELIVERY", entity: "NotificationDelivery", entityId: "delivery", createdAt: "2026-11-25T00:00:00Z" };
  auditLogService.getAuditLogs.mockResolvedValue({ items: [row], total: 1 });
  auditLogService.getAuditLog.mockResolvedValue({ ...row, after: { supplementStartAt: "2026-11-25T01:00:00Z", attemptCount: 2, channel: "WEB_PUSH", status: "SKIPPED", errorCode: "NO_SUBSCRIPTION", finalRating: "GOOD", reportType: "UNIT_APPRAISAL_MINUTES", unitCode: "DON_VI_TRUC_THUOC", username: "GOOD", adminComment: "Nội dung người dùng giữ nguyên" } });
  render(<AdminAuditLog />);
  fireEvent.click(await screen.findByText("Xem thay đổi"));
  await screen.findByText("Chưa đăng ký thiết bị nhận thông báo");
  expect(screen.getByText("Số lần thử gửi")).toBeInTheDocument();
  expect(screen.getByText("Ngày giờ mở bổ sung")).toBeInTheDocument();
  expect(screen.getByText("Tốt")).toBeInTheDocument();
  expect(screen.getByText("Biên bản thẩm định đơn vị")).toBeInTheDocument();
  expect(screen.getByText("GOOD")).toBeInTheDocument();
  expect(screen.getByText("DON_VI_TRUC_THUOC")).toBeInTheDocument();
  expect(screen.getByText("Nội dung người dùng giữ nguyên")).toBeInTheDocument();
  expect(screen.queryByText(/WEB_PUSH|NO_SUBSCRIPTION|supplementStartAt|attemptCount/u)).toBeNull();
});

/** Lỗi tải không được bị che thành dữ liệu rỗng thành công, người dùng có thể thử lại */
test("audit hiển thị lỗi rồi tải lại trạng thái không có dữ liệu", async () => {
  auditLogService.getAuditLogs.mockRejectedValueOnce(new Error("Không thể tải nhật ký hoạt động")); render(<AdminAuditLog />);
  await screen.findByText("Không thể tải nhật ký hoạt động"); auditLogService.getAuditLogs.mockResolvedValue({ items: [], total: 0 }); fireEvent.click(screen.getByText("Tải lại nhật ký"));
  await waitFor(() => expect(screen.queryByText("Không thể tải nhật ký hoạt động")).toBeNull()); expect(screen.getByText("Không có nhật ký phù hợp")).toBeInTheDocument();
});
