import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Alert, Button, Spin } from "antd";

/** Xác nhận phiên với server trước khi mở trang, lỗi mạng có đường thử lại an toàn */
export function RequireAuth() {
  const { user, loading, restoreError, retryRestore } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <Spin size="large" tip="Đang tải..." />
      </div>
    );
  }

  if (restoreError) return <Alert type="error" title={restoreError} action={<Button onClick={retryRestore}>Thử kiểm tra lại phiên</Button>} />;
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

// Trạm 2: Bắt buộc đổi mật khẩu (Dùng cho tài khoản lần đầu)
export function RequirePasswordChanged() {
  const { user } = useAuth();
  if (user?.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

// Trạm 3: Phân quyền (ADMIN / UNIT)
export function RequireRole({ roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) {
    return <Navigate to="/403" replace />; // Trang báo lỗi không có quyền
  }
  return <Outlet />;
}
