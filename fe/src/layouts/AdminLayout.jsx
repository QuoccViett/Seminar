import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu, Avatar, Dropdown, Badge, Button, Breadcrumb } from "antd";
import {
  DashboardOutlined,
  TeamOutlined,
  BankOutlined,
  SettingOutlined,
  FileTextOutlined,
  HistoryOutlined,
  BellOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import { useAuth } from "../contexts/AuthContext";
import styles from "./AdminLayout.module.css";
import { getUnreadCount } from "../services/notificationService";
import { PERIOD_KEY } from "../services/periodSelection";
import SessionNotice from "../components/common/SessionNotice";
import { startVisiblePolling } from "../services/visiblePolling";

const { Header, Sider, Content } = Layout;

/** Khung ADMIN thích ứng màn hình nhỏ, hỗ trợ bàn phím và breadcrumb theo route
 * Menu mang theo kỳ đang chọn cho các trang có scope kỳ, không mang theo quyền hoặc nội dung cache
 */
export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const inboxPath = user?.role === "UNIT" ? "/unit/notifications" : "/admin/notifications";

  /** Đọc số chưa xem từ backend khi đổi trang, quay lại tab hoặc đến nhịp làm mới
   * Khi mạng lỗi giữ số cuối cùng và để trang hộp thư hiển thị lỗi riêng
   */
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const result = await getUnreadCount(); if (active) setUnreadCount(result.count); }
      catch { return false; }
    };
    const stop = startVisiblePolling(refresh, { intervalMs: 30000, events: ["notifications:changed"] });
    return () => { active = false; stop(); };
  }, [location.pathname]);

  // Lấy tên trang hiện tại để hiển thị lên Header
  const pageTitles = {
    "/admin/dashboard": "Tổng quan",
    "/admin/users": "Quản lý Tài khoản",
    "/admin/units": "Quản lý Đơn vị",
    "/admin/config": "Cấu hình Kỳ thi",
    "/admin/records": "Xử lý Hồ sơ",
    "/admin/audit-log": "Lịch sử thao tác",
    "/admin/reports": "Báo cáo",
    "/admin/notifications": "Hộp thư thông báo",
    "/unit/notifications": "Hộp thư thông báo",
    "/unit/records": "Trang tự chấm",
  };
  const currentTitle = pageTitles[location.pathname] || "";

  // Menu UNIT chỉ chứa các tuyến được phép, còn ADMIN giữ phần quản trị và cùng hộp thư riêng
  const adminMenuItems = [
    { key: "/admin/dashboard", icon: <DashboardOutlined />, label: "Tổng quan" },
    { key: "/admin/users", icon: <TeamOutlined />, label: "Quản lý Tài khoản" },
    { key: "/admin/units", icon: <BankOutlined />, label: "Quản lý Đơn vị" },
    { key: "/admin/config", icon: <SettingOutlined />, label: "Cấu hình Kỳ thi" },
    { key: "/admin/records", icon: <FileTextOutlined />, label: "Xử lý Hồ sơ" },
    { key: "/admin/audit-log", icon: <HistoryOutlined />, label: "Lịch sử thao tác" },
    { key: "/admin/reports", icon: <FileTextOutlined />, label: "Báo cáo" },
    { key: "/admin/notifications", icon: <BellOutlined />, label: "Hộp thư thông báo" },
  ];
  const menuItems = user?.role === "UNIT" ? [
    { key: "/unit/records", icon: <FileTextOutlined />, label: "Trang tự chấm" },
    { key: "/unit/notifications", icon: <BellOutlined />, label: "Hộp thư thông báo" },
  ] : adminMenuItems;

  const userMenu = {
    items: [
      { key: "password", label: "Đổi mật khẩu", onClick: () => navigate("/change-password") },
      { key: "logout", icon: <LogoutOutlined />, label: "Đăng xuất", onClick: () => logout() },
    ],
  };

  return (
    <Layout className={styles.layoutContainer}>
      {/* SIDEBAR TRẮNG */}
      <Sider trigger={null} collapsible collapsed={collapsed} breakpoint="lg" onBreakpoint={setCollapsed} width={260} collapsedWidth={64} className={styles.sider}>
        <div className={styles.siderHeader}>
          {!collapsed && <span className={styles.logoText}>HỆ THỐNG KPI</span>}
          <button aria-label={collapsed ? "Mở menu quản trị" : "Thu gọn menu quản trị"} className={styles.collapseBtn} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </div>

        <Menu
          theme="light" 
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => { const period = sessionStorage.getItem(PERIOD_KEY); navigate(["/admin/dashboard", "/admin/records", "/admin/reports"].includes(key) && period ? `${key}?periodId=${encodeURIComponent(period)}` : key); }}
        />
      </Sider>

      <Layout>
        {/* HEADER TRẮNG */}
        <Header className={styles.header}>
          <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 600, color: "var(--app-text)" }}>
            {currentTitle}
          </h2>

          {/* Bên phải*/}
          <div className={styles.headerRight}>
            <Badge count={unreadCount} size="small">
              <Button type="text" aria-label="Mở hộp thư thông báo" onClick={() => navigate(inboxPath)} icon={<BellOutlined style={{ fontSize: 18, color: "var(--app-muted)" }} />} />
            </Badge>

            <Dropdown menu={userMenu} placement="bottomRight" trigger={["click"]}>
              <button className={styles.userInfo} aria-label="Mở tùy chọn tài khoản">
                <Avatar size="small" icon={<UserOutlined />} />
                <span>{user?.fullName || user?.username}</span>
              </button>
            </Dropdown>
          </div>
        </Header>

        {/* CONTENT */}
        <Content className={styles.content}>
          <div className={styles.innerContent}>
             <SessionNotice />
             <Breadcrumb items={[{ title: "Quản trị" }, { title: currentTitle }]} style={{ marginBottom: 16 }} />
             <Outlet />
          </div>
        </Content>

      </Layout>
    </Layout>
  );
}
