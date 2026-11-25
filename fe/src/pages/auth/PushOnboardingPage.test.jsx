import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import PushOnboardingPage from "./PushOnboardingPage";
import { enableWebPushWithInvitation } from "../../services/webPush";

vi.mock("../../services/webPush", () => ({ enableWebPushWithInvitation: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); window.history.replaceState(null, "", "/"); });

/** Mở liên kết không tự xin permission, fragment được gỡ trước mọi thao tác đăng ký */
test("lời mời gỡ token khỏi URL và chỉ đăng ký sau thao tác chủ động", async () => {
  window.history.replaceState(null, "", "/onboarding/web-push#token=loi-moi-fixture");
  enableWebPushWithInvitation.mockResolvedValue({});
  render(<PushOnboardingPage />);
  expect(window.location.hash).toBe("");
  expect(enableWebPushWithInvitation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Đăng ký thiết bị này" }));
  expect(await screen.findByText(/Đã đăng ký thiết bị nhận thông báo/u)).toBeInTheDocument();
  expect(enableWebPushWithInvitation).toHaveBeenCalledWith("loi-moi-fixture");
  expect(screen.getByRole("button", { name: /Đăng ký thiết bị này/u })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Đến đăng nhập" })).toHaveAttribute("href", "/login");
});

test("thiếu token khóa nút và lỗi đăng ký được hiển thị để thử lại", async () => {
  const view = render(<PushOnboardingPage />);
  expect(await screen.findByText("Liên kết mời không hợp lệ.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Đăng ký thiết bị này" })).toBeDisabled();
  view.unmount();
  window.history.replaceState(null, "", "/onboarding/web-push#token=loi-moi-het-han");
  enableWebPushWithInvitation.mockRejectedValue(new Error("Liên kết mời không còn hiệu lực."));
  render(<PushOnboardingPage />);
  fireEvent.click(screen.getByRole("button", { name: "Đăng ký thiết bị này" }));
  expect(await screen.findByText("Liên kết mời không còn hiệu lực.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Đăng ký thiết bị này/u })).not.toBeDisabled();
});
