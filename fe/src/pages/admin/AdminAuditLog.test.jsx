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
  render(<AdminAuditLog />); fireEvent.change(screen.getByLabelText("Hành động"), { target: { value: "REVIEW_SCORE" } }); fireEvent.click(screen.getByText("Lọc nhật ký"));
  await waitFor(() => expect(auditLogService.getAuditLogs).toHaveBeenLastCalledWith({ action: "REVIEW_SCORE", page: 1, pageSize: 20 }));
  fireEvent.click(await screen.findByText("Xem thay đổi")); await screen.findByText("Trước thay đổi"); expect(await screen.findByText(/Thiếu nội dung/)).toBeInTheDocument();
});

/** Lỗi tải không được bị che thành dữ liệu rỗng thành công, người dùng có thể thử lại */
test("audit hiển thị lỗi rồi tải lại trạng thái không có dữ liệu", async () => {
  auditLogService.getAuditLogs.mockRejectedValueOnce(new Error("Không thể tải nhật ký hoạt động")); render(<AdminAuditLog />);
  await screen.findByText("Không thể tải nhật ký hoạt động"); auditLogService.getAuditLogs.mockResolvedValue({ items: [], total: 0 }); fireEvent.click(screen.getByText("Tải lại nhật ký"));
  await waitFor(() => expect(screen.queryByText("Không thể tải nhật ký hoạt động")).toBeNull()); expect(screen.getByText("Không có nhật ký phù hợp")).toBeInTheDocument();
});
