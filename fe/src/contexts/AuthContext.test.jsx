import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { authService } from "../services/authService";
import { RequireAuth } from "../routes/guards";
import LoginPage from "../pages/auth/LoginPage";

/** Hiển thị trạng thái khôi phục qua giao diện công khai của provider
 * Nhờ vậy phép thử phát hiện trạng thái tải kéo dài mà người dùng nhìn thấy
 */
function SessionStatus() {
  const { loading, user } = useAuth();
  return <span>{loading ? "Đang tải" : user?.fullName ?? "Chưa đăng nhập"}</span>;
}

/** Gỡ provider và listener phiên của từng phép thử trước khi xóa bộ nhớ và spy
 * Vitest không bật globals nên cleanup tường minh tránh sự kiện refresh chạy sang cây React cũ
 */
afterEach(() => {
  cleanup();
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

/** Role cache không mở trang khi máy chủ không xác nhận phiên, người dùng có thể thử lại sau lỗi mạng */
test("không dùng danh tính cache khi kiểm phiên thất bại", async () => {
  sessionStorage.setItem("accessToken", "access-thu");
  sessionStorage.setItem("currentUser", JSON.stringify({ id: "cu", fullName: "Quyền cache cũ", role: "ADMIN" }));
  vi.spyOn(authService, "getMe").mockRejectedValue({ message: "Không thể kết nối máy chủ" });
  render(<MemoryRouter><AuthProvider><SessionStatus /></AuthProvider></MemoryRouter>);
  expect(await screen.findByText("Chưa đăng nhập")).toBeInTheDocument();
  expect(screen.queryByText("Quyền cache cũ")).not.toBeInTheDocument();
});

/** Phiên bị server từ chối phải xóa quyền và giữ lời nhắc ngay cả khi guard cũng chuyển về login
 * Dùng provider, guard và trang login thật để bắt cạnh tranh điều hướng, không chỉ kiểm state nội bộ
 * Hai sự kiện 401 cùng lúc mô phỏng các request nghiệp vụ đồng thời nhưng không giả backend cho nghiệm thu Chrome
 */
test("thông báo hết phiên không mất khi guard đồng thời điều hướng", async () => {
  sessionStorage.setItem("accessToken", "access-thu");
  vi.spyOn(authService, "getMe").mockResolvedValue({ id: "thu-het-phien", fullName: "Người đang thao tác", role: "UNIT" });
  render(<MemoryRouter initialEntries={["/unit/records"]}><AuthProvider><Routes>
    <Route element={<RequireAuth />}><Route path="/unit/records" element={<SessionStatus />} /></Route>
    <Route path="/login" element={<LoginPage />} />
  </Routes></AuthProvider></MemoryRouter>);
  await screen.findByText("Người đang thao tác");
  act(() => { window.dispatchEvent(new CustomEvent("auth:unauthorized")); window.dispatchEvent(new CustomEvent("auth:unauthorized")); });
  expect(await screen.findByText("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Đăng nhập", exact: true })).toBeInTheDocument();
  expect(sessionStorage.getItem("accessToken")).toBeNull();
});
