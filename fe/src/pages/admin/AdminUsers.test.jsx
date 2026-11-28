import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal } from "antd";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AdminUsers from "./AdminUsers";
import { userService } from "../../services/userService";
import { unitService } from "../../services/unitService";

vi.mock("../../services/userService", () => ({ userService: { getUsers: vi.fn(), getCredentialStatus: vi.fn(), previewImport: vi.fn(), confirmImport: vi.fn() } }));
vi.mock("../../services/unitService", () => ({ unitService: { getUnits: vi.fn() } }));

beforeEach(() => {
  userService.getUsers.mockResolvedValue({ items: [{ id: "user", username: "tai-khoan", fullName: "Tài khoản kiểm thử", role: "UNIT", isActive: true }], total: 1 });
  unitService.getUnits.mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => { Modal.destroyAll(); cleanup(); vi.resetAllMocks(); });

/** Kiểm DOM thật của bảng và modal, gồm lý do chưa gửi mà không đổi payload định danh của API */
test("tài khoản có vai trò và trạng thái kênh bằng tiếng Việt", async () => {
  userService.getCredentialStatus.mockResolvedValue({ status: "QUEUED", allRequiredChannelsSent: false, channels: [{ channel: "EMAIL", status: "PENDING", errorCode: "EMAIL_UNCONFIRMED" }, { channel: "WEB_PUSH", status: "SKIPPED", errorCode: "NO_SUBSCRIPTION" }] });
  render(<AdminUsers />);
  expect(await screen.findByRole("cell", { name: "Đơn vị tự chấm", exact: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Trạng thái gửi", exact: true }));
  await screen.findByText("Email: Đang chờ xử lý · Chưa xác nhận địa chỉ email nhận thông tin đăng nhập");
  expect(screen.getByText("Thông báo trình duyệt: Đã bỏ qua · Chưa đăng ký thiết bị nhận thông báo")).toBeInTheDocument();
  expect(screen.queryByText(/EMAIL_UNCONFIRMED|NO_SUBSCRIPTION|WEB_PUSH/u)).toBeNull();
  expect(userService.getCredentialStatus).toHaveBeenCalledWith("user");
});

/** Một lỗi preview phải chỉ đúng cột bằng tên tiếng Việt và giữ confirm bị khóa */
test("preview import hiển thị tên trường và nội dung lỗi thay mã parser", async () => {
  userService.previewImport.mockResolvedValue({ importId: "import", expiresAt: "2026-11-25T10:00:00Z", totalRows: 1, validRows: 0, invalidRows: 1, rows: [{ rowNumber: 2, unitCode: "DV001", unitName: "Đơn vị", username: "taikhoan", fullName: "Tài khoản", email: "", phone: "", errors: [{ code: "REQUIRED", field: "email", message: "email là bắt buộc." }] }] });
  const view = render(<AdminUsers />);
  fireEvent.click(await screen.findByRole("button", { name: /Import Excel/u }));
  const input = view.baseElement.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(["fixture"], "tai-khoan.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Xem trước và kiểm tra" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Xem trước và kiểm tra" }));
  expect(await screen.findByText("Email: Email là bắt buộc.", { exact: false })).toBeInTheDocument();
  expect(screen.queryByText("REQUIRED")).toBeNull();
  expect(screen.getByRole("button", { name: "Xác nhận tạo tài khoản" })).toBeDisabled();
  expect(userService.confirmImport).not.toHaveBeenCalled();
});

test("nút xác nhận import giữ tên truy cập khi đang gửi và sau khi mở lại modal", async () => {
  let finishImport;
  userService.previewImport.mockResolvedValue({ importId: "import-valid", expiresAt: "2099-01-01T00:00:00Z", totalRows: 1, validRows: 1, invalidRows: 0, rows: [] });
  userService.confirmImport.mockImplementation(() => new Promise((resolve) => { finishImport = resolve; }));
  const view = render(<AdminUsers />);
  fireEvent.click(await screen.findByRole("button", { name: /Import Excel/u }));
  const input = view.baseElement.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(["fixture"], "valid.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })] } });
  fireEvent.click(await screen.findByRole("button", { name: "Xem trước và kiểm tra", exact: true }));
  const confirm = await screen.findByRole("button", { name: "Xác nhận tạo tài khoản", exact: true });
  await waitFor(() => expect(confirm).not.toBeDisabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(userService.confirmImport).toHaveBeenCalledTimes(1));
  try {
    expect(screen.getByRole("button", { name: "Xác nhận tạo tài khoản", exact: true })).toHaveAttribute("aria-busy", "true");
  } finally { finishImport({ createdCount: 1, unitsCreated: 1, accounts: [] }); }
  await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "false"));
  const dialog = confirm.closest('[role="dialog"]');
  fireEvent.click(within(dialog.querySelector(".ant-modal-footer")).getByRole("button", { name: "Đóng", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: /Import Excel/u }));
  expect(await screen.findByRole("button", { name: "Xác nhận tạo tài khoản", exact: true })).toBeDisabled();
});
