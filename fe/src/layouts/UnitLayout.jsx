import { useEffect, useState } from "react";
import { Avatar, Badge, Breadcrumb, Button, Dropdown, Layout, Menu, Space, Typography } from "antd";
import { BellOutlined, DashboardOutlined, FileTextOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, UserOutlined } from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import SessionNotice from "../components/common/SessionNotice";
import { getUnreadCount } from "../services/notificationService";
import styles from "./UnitLayout.module.css";

const { Header, Sider, Content } = Layout;

/** Khung UNIT có sidebar riêng, chỉ hiển thị các trang mà vai trò này được phép truy cập */
export default function UnitLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await getUnreadCount();
        if (active) setUnreadCount(result.count);
      } catch { /* Giữ số đã biết nếu mạng tạm thời lỗi */ }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("notifications:changed", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("notifications:changed", refresh);
    };
  }, [location.pathname]);

  const currentTitle = location.pathname.includes("notifications") ? "Hộp thư thông báo"
    : location.pathname.includes("profile") ? "Hồ sơ cá nhân"
      : location.pathname.includes("records") ? "Hồ sơ tự chấm" : "Tổng quan";
  const menuItems = [
    { key: "/unit/dashboard", icon: <DashboardOutlined />, label: "Tổng quan" },
    { key: "/unit/records", icon: <FileTextOutlined />, label: "Hồ sơ tự chấm" },
    { key: "/unit/notifications", icon: <BellOutlined />, label: "Hộp thư thông báo" },
    { key: "/unit/profile", icon: <UserOutlined />, label: "Hồ sơ cá nhân" },
  ];
  const userMenu = {
    items: [
      { key: "password", label: "Đổi mật khẩu", onClick: () => navigate("/change-password") },
      { key: "logout", icon: <LogoutOutlined />, label: "Đăng xuất", onClick: logout },
    ],
  };

  return <Layout className={styles.layoutContainer}>
    <Sider trigger={null} collapsible collapsed={collapsed} breakpoint="lg" onBreakpoint={setCollapsed} width={260} collapsedWidth={64} className={styles.sider}>
      <div className={styles.siderHeader}>
        {!collapsed && <span className={styles.logoText}>CỔNG ĐƠN VỊ</span>}
        <button aria-label={collapsed ? "Mở menu đơn vị" : "Thu gọn menu đơn vị"} className={styles.collapseBtn} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </button>
      </div>
      <Menu theme="light" mode="inline" selectedKeys={[location.pathname]} items={menuItems} onClick={({ key }) => navigate(key)} />
    </Sider>

    <Layout className={styles.mainLayout}>
      <Header className={styles.header}>
        <Typography.Title level={4} style={{ margin: 0 }}>{currentTitle}</Typography.Title>
        <Space className={styles.headerActions}>
          <Badge count={unreadCount} size="small">
            <Button type="text" aria-label={`Mở hộp thư thông báo${unreadCount ? `, ${unreadCount} chưa đọc` : ""}`} onClick={() => navigate("/unit/notifications")} icon={<BellOutlined style={{ fontSize: 18, color: "#555" }} />} />
          </Badge>
          <Dropdown menu={userMenu} placement="bottomRight" trigger={["click"]}>
            <button className={styles.userInfo} aria-label="Mở tùy chọn tài khoản">
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user?.fullName || user?.username}</span>
            </button>
          </Dropdown>
        </Space>
      </Header>
      <Content className={styles.content}>
        <div className={styles.innerContent}>
          <SessionNotice />
          <Breadcrumb items={[{ title: "Đơn vị" }, { title: currentTitle }]} style={{ marginBottom: 16 }} />
          <Outlet />
        </div>
      </Content>
    </Layout>
  </Layout>;
}
