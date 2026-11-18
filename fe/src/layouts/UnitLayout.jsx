import { Button, Layout, Space, Typography } from "antd";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import SessionNotice from "../components/common/SessionNotice";

/** Khung UNIT chỉ có hồ sơ và hộp thư của phiên hiện tại, không đưa menu quản trị vào DOM
 * Điều hướng vẫn qua router guard và API kiểm quyền, nội dung rộng được cuộn trong vùng chính
 */
export default function UnitLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  return <Layout style={{ minHeight: "100dvh", height: "100%", overflow: "auto" }}>
    <header className="unit-header"><Typography.Title level={3}>Cổng đơn vị</Typography.Title><Space wrap><Typography.Text>{user.fullName}</Typography.Text><Button onClick={logout}>Đăng xuất</Button></Space></header>
    <nav className="unit-nav" aria-label="Điều hướng đơn vị"><Link aria-current={location.pathname === "/unit/records" ? "page" : undefined} to="/unit/records">Hồ sơ tự chấm</Link><Link aria-current={location.pathname === "/unit/notifications" ? "page" : undefined} to="/unit/notifications">Hộp thư thông báo</Link><Link to="/change-password">Đổi mật khẩu</Link></nav>
    <main className="unit-content" id="main-content"><SessionNotice /><Typography.Paragraph type="secondary">Đơn vị / {location.pathname.includes("notifications") ? "Hộp thư thông báo" : "Hồ sơ tự chấm"}</Typography.Paragraph><Outlet /></main>
  </Layout>;
}
