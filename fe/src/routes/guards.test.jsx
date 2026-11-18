import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { RequireAuth, RequirePasswordChanged, RequireRole } from "./guards";

const auth = vi.hoisted(() => ({ user: null, loading: false }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => auth }));
afterEach(() => { cleanup(); auth.user = null; });

/** Dựng tuyến bảo vệ tối thiểu để kiểm direct URL trước khi component nghiệp vụ có thể tải dữ liệu */
function GuardTree() {
  return <MemoryRouter initialEntries={["/admin/records?periodId=thu"]}><Routes><Route element={<RequireAuth />}><Route path="/change-password" element={<span>Đổi mật khẩu bắt buộc</span>} /><Route element={<RequirePasswordChanged />}><Route element={<RequireRole roles={["ADMIN"]} />}><Route path="/admin/records" element={<span>Nội dung quản trị</span>} /></Route></Route></Route><Route path="/login" element={<span>Cần đăng nhập</span>} /><Route path="/403" element={<span>Không có quyền</span>} /></Routes></MemoryRouter>;
}

/** Mở trực tiếp trang ADMIN bằng UNIT phải dừng trước nội dung và mọi request của trang */
test("direct URL sai vai trò chuyển 403", async () => {
  auth.user = { role: "UNIT", mustChangePassword: false };
  render(<GuardTree />);
  expect(await screen.findByText("Không có quyền")).toBeInTheDocument();
  expect(screen.queryByText("Nội dung quản trị")).toBeNull();
});

/** Người có cờ bắt đổi chỉ vào flow đổi mật khẩu dù direct URL và role đều hợp lệ */
test("cờ bắt đổi mật khẩu luôn chặn trang nghiệp vụ", async () => {
  auth.user = { role: "ADMIN", mustChangePassword: true };
  render(<GuardTree />);
  expect(await screen.findByText("Đổi mật khẩu bắt buộc")).toBeInTheDocument();
});
