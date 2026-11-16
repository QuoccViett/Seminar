import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { authService } from "../services/authService";

/** Hiển thị trạng thái khôi phục qua giao diện công khai của provider
 * Nhờ vậy phép thử phát hiện trạng thái tải kéo dài mà người dùng nhìn thấy
 */
function SessionStatus() {
  const { loading, user } = useAuth();
  return <span>{loading ? "Đang tải" : user?.fullName ?? "Chưa đăng nhập"}</span>;
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

/** StrictMode hủy effect đầu rồi chạy lại khi đã có phiên lưu trên trình duyệt
 * Hồ sơ từ backend phải kết thúc trạng thái tải dù phản hồi đầu đã bị hủy
 */
test("khôi phục phiên trong StrictMode không kẹt tải", async () => {
  sessionStorage.setItem("accessToken", "access-thu");
  sessionStorage.setItem("refreshToken", "refresh-thu");
  vi.spyOn(authService, "getMe").mockResolvedValue({ id: "1", fullName: "Người dùng thử" });

  render(<StrictMode><MemoryRouter><AuthProvider><SessionStatus /></AuthProvider></MemoryRouter></StrictMode>);

  expect(await screen.findByText("Người dùng thử")).toBeInTheDocument();
  expect(screen.queryByText("Đang tải")).not.toBeInTheDocument();
});

/** Khi lệnh xem hồ sơ làm mới phiên, effect phải giữ token vừa xoay vòng thay vì ghi đè token cũ
 * Mô phỏng thay đổi bộ nhớ phiên ngay trước khi phản hồi hồ sơ hoàn tất
 */
test("khôi phục hồ sơ giữ access token vừa làm mới", async () => {
  sessionStorage.setItem("accessToken", "access-cu");
  sessionStorage.setItem("refreshToken", "refresh-cu");
  vi.spyOn(authService, "getMe").mockImplementation(async () => {
    sessionStorage.setItem("accessToken", "access-moi");
    sessionStorage.setItem("refreshToken", "refresh-moi");
    return { id: "1", fullName: "Phiên mới" };
  });
  render(<MemoryRouter><AuthProvider><SessionStatus /></AuthProvider></MemoryRouter>);
  expect(await screen.findByText("Phiên mới")).toBeInTheDocument();
  expect(sessionStorage.getItem("accessToken")).toBe("access-moi");
  expect(sessionStorage.getItem("refreshToken")).toBe("refresh-moi");
});
