import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequirePasswordChanged, RequireRole } from "./guards";
import LoginPage from "../pages/auth/LoginPage";
import ChangePasswordPage from "../pages/auth/ChangePasswordPage";
import AdminDashboard from "../pages/admin/AdminDashboard";
import AdminUsers from "../pages/admin/AdminUsers";
import AdminUnits from "../pages/admin/AdminUnits";
import AdminAuditLog from "../pages/admin/AdminAuditLog";
import AdminConfig from "../pages/admin/AdminConfig";
// 1. Import AdminLayout vào
import AdminLayout from "../layouts/AdminLayout";
import NotificationInbox from "../pages/NotificationInbox";
import PushOnboardingPage from "../pages/auth/PushOnboardingPage";
import UnitRecords from "../pages/unit/UnitRecords";

// Tạm thời tạo các trang giả để test Layout
const AdminRecords = () => <div style={{ fontSize: 24, fontWeight: "bold" }}>Xử lý Hồ sơ</div>;
const Forbidden = () => <div style={{ padding: 20, color: "red" }}>403 - Bạn không có quyền truy cập!</div>;

export default function AppRoutes() {
  return (
    <Routes>
      {/* Trang public */}
      <Route path="/login" element={<LoginPage />} />
      {/* Link mời có quyền hẹp được mở trước khi tài khoản có phiên đăng nhập */}
      <Route path="/onboarding/web-push" element={<PushOnboardingPage />} />

      {/* Đã đăng nhập mới được vào */}
      <Route element={<RequireAuth />}>
        
        {/* Bị ép đổi mật khẩu thì chỉ hiện trang này */}
        <Route path="/change-password" element={<ChangePasswordPage />} />

        {/* Đã đổi mật khẩu rồi mới được vào các trang dưới */}
        <Route element={<RequirePasswordChanged />}>
          
          {/* ================= KHU VỰC ADMIN ================= */}
          <Route element={<RequireRole roles={["ADMIN"]} />}>
            {/* 2. Bọc AdminLayout ở đây. Các trang con sẽ tự động lọt vào <Outlet /> của Layout này */}
            <Route element={<AdminLayout />}>
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/units" element={<AdminUnits />} />
              <Route path="/admin/config" element={<AdminConfig />} />
              <Route path="/admin/records" element={<AdminRecords />} />
              <Route path="/admin/audit-log" element={<AdminAuditLog />} />
              {/* Hộp thư quản trị dùng API thật và chỉ lấy dữ liệu thuộc access token hiện tại */}
              <Route path="/admin/notifications" element={<NotificationInbox />} />
            </Route>
          </Route>

          {/* ================= KHU VỰC UNIT ================= */}
          <Route element={<RequireRole roles={["UNIT"]} />}>
            {/* UNIT dùng cùng layout và hộp thư, menu được giới hạn theo role đã xác thực */}
            <Route element={<AdminLayout />}>
              <Route path="/unit/records" element={<UnitRecords />} />
              <Route path="/unit/notifications" element={<NotificationInbox />} />
            </Route>
          </Route>

        </Route>
      </Route>

      {/* Lỗi 403 */}
      <Route path="/403" element={<Forbidden />} />

      {/* Mặc định vào trang login nếu gõ sai đường dẫn */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
