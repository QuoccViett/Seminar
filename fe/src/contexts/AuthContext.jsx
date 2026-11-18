import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authService } from "../services/authService";
import {
  getAccessToken,
  getRefreshToken,
  getCurrentUser,
  setSession,
  clearSession,
} from "../services/session";

const AuthContext = createContext(null);

/** Xác thực hồ sơ bằng backend trước khi mở nghiệp vụ, khôi phục lỗi mạng có đường thử lại
 * Mọi refresh/đổi mật khẩu cập nhật danh tính cùng token, cache không được cấp quyền khi server chưa xác nhận
 */
export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restoreError, setRestoreError] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    // Mỗi lần effect chạy đều khôi phục phiên riêng để StrictMode có thể hủy lần đầu và chạy lại
    // Cờ hủy ngăn phản hồi cũ cập nhật trạng thái sau khi effect đã dọn dẹp
    let cancelled = false;

    async function restore() {
      const accessToken = getAccessToken();
      if (!accessToken) {
        setLoading(false);
        return;
      }

      setLoading(true); setRestoreError("");

      try {
        const fresh = await authService.getMe();
        if (cancelled) return;
        setUser(fresh);
        setSession({
          accessToken: getAccessToken(),
          refreshToken: getRefreshToken(),
          user: fresh,
        });
      } catch (err) {
        if (cancelled) return;
        // Hồ sơ cache không xác nhận được quyền, lỗi mạng cho thử lại thay vì mở trang bằng role cũ
        setUser(null);
        if (err.status !== 401) setRestoreError(err.message || "Không thể kiểm tra phiên đăng nhập, vui lòng thử lại");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    restore();
    return () => { cancelled = true; };
  }, [retry]);

  useEffect(() => {
    const onUnauthorized = () => {
      // Guard cũng điều hướng khi user thành null và có thể ghi đè location.state của lệnh navigate
      // Giữ câu thông báo trong provider tới lần đăng nhập/đăng xuất có chủ đích để nhiều 401 không làm mất lý do
      setSessionMessage("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      clearSession();
      setUser(null);
      navigate("/login", {
        replace: true,
        state: { message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." },
      });
    };
    window.addEventListener("auth:unauthorized", onUnauthorized);
    /** Nhận hồ sơ refresh và yêu cầu đổi mật khẩu từ BE, không tin role từ form hoặc cache */
    const onSession = (event) => { if (event.detail) setUser(event.detail); };
    const onPassword = () => { setUser((current) => current ? { ...current, mustChangePassword: true } : null); navigate("/change-password", { replace: true }); };
    window.addEventListener("auth:session", onSession);
    window.addEventListener("auth:password-required", onPassword);
    return () => { window.removeEventListener("auth:unauthorized", onUnauthorized); window.removeEventListener("auth:session", onSession); window.removeEventListener("auth:password-required", onPassword); };
  }, [navigate]);

  /** Gửi credential và nhận toàn bộ cặp token/hồ sơ/TTL từ backend, thiếu dữ liệu thì từ chối phiên
   * Không dùng role nhập từ client để dựng user, sự kiện session đồng bộ các thành phần cùng tab
   */
  const login = useCallback(async (username, password) => {
    const result = await authService.login(username, password);
    // contract login: { accessToken, refreshToken, tokenType, expiresIn, user }
    const { accessToken, refreshToken, user: nextUser } = result ?? {};

    if (!accessToken || !refreshToken || !nextUser) {
      throw {
        message: "Phản hồi đăng nhập không hợp lệ (thiếu token hoặc user).",
      };
    }

    setSession(result);
    setSessionMessage("");
    setUser(nextUser);
    return nextUser;
  }, []);

  // ---------- Logout ----------
  /** Thu hồi phiên trên máy chủ khi có token và luôn xóa phiên cục bộ sau đó
   * Lỗi mạng không ghi đối tượng lỗi vì đối tượng đó có thể chứa thông tin xác thực
   */
  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) await authService.logout(refreshToken);
    } catch {
      console.warn("Không thể thu hồi phiên trên máy chủ, phiên cục bộ đã được xóa");
    } finally {
      clearSession();
      setSessionMessage("");
      setUser(null);
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  /** Lưu nguyên cặp token thay thế do backend cấp sau khi đổi mật khẩu thành công
   * Phiên cũ đã bị thu hồi nên không được giữ access hoặc refresh token trước đó
   */
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const result = await authService.changePassword(currentPassword, newPassword);
    if (!result?.accessToken || !result?.refreshToken || !result?.user) {
      throw { message: "Phản hồi đổi mật khẩu không hợp lệ." };
    }
    setSession(result);
    setUser(result.user);
    window.dispatchEvent(new CustomEvent("workspace:clear"));
    return result.user;
  }, []);
  const value = {
    user,
    loading,
    restoreError,
    sessionMessage,
    retryRestore: () => setRetry((value) => value + 1),
    isAuthenticated: !!user,
    login,
    logout,
    changePassword,
    role: user?.role ?? null,
    mustChangePassword: !!user?.mustChangePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Trả ngữ cảnh đăng nhập cho component và báo lỗi rõ ràng khi thiếu provider */
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("Cần dùng useAuth bên trong AuthProvider");
  return ctx;
};
