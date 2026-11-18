import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Spin } from "antd";
import { RequireAuth, RequirePasswordChanged, RequireRole } from "./guards";
import AdminLayout from "../layouts/AdminLayout";
import UnitLayout from "../layouts/UnitLayout";
import StatusPage from "../pages/StatusPage";

// Tải mã của từng trang khi đi tới tuyến đó để màn đăng nhập không chờ toàn bộ giao diện quản trị
// Guard được dựng trước trang nghiệp vụ, tải module không đồng nghĩa có quyền truy vấn dữ liệu
const LoginPage = lazy(() => import("../pages/auth/LoginPage"));
const ChangePasswordPage = lazy(() => import("../pages/auth/ChangePasswordPage"));
const AdminDashboard = lazy(() => import("../pages/admin/AdminDashboard"));
const AdminUsers = lazy(() => import("../pages/admin/AdminUsers"));
const AdminUnits = lazy(() => import("../pages/admin/AdminUnits"));
const AdminAuditLog = lazy(() => import("../pages/admin/AdminAuditLog"));
const AdminConfig = lazy(() => import("../pages/admin/AdminConfig"));
const NotificationInbox = lazy(() => import("../pages/NotificationInbox"));
const PushOnboardingPage = lazy(() => import("../pages/auth/PushOnboardingPage"));
const UnitRecords = lazy(() => import("../pages/unit/UnitRecords"));
const AdminRecords = lazy(() => import("../pages/admin/AdminRecords"));
const AdminReports = lazy(() => import("../pages/admin/AdminReports"));

/** Ghép đầy đủ trang thật và guard theo thứ tự xác thực, đổi mật khẩu rồi vai trò
 * Reload/direct URL vẫn đi qua cùng guard, tuyến lạ hiện 404 có đường quay lại
 */
export default function AppRoutes() {
  return (
    <Suspense fallback={<div role="status" style={{ padding: 24 }}><Spin /> Đang tải giao diện, vui lòng chờ</div>}><Routes>
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
              {/* Báo cáo chỉ trong nhánh ADMIN đã đổi mật khẩu, mọi thao tác tạo và tải gọi API thật */}
              <Route path="/admin/reports" element={<AdminReports />} />
              {/* Hộp thư quản trị dùng API thật và chỉ lấy dữ liệu thuộc access token hiện tại */}
              <Route path="/admin/notifications" element={<NotificationInbox />} />
            </Route>
          </Route>

          {/* ================= KHU VỰC UNIT ================= */}
          <Route element={<RequireRole roles={["UNIT"]} />}>
            {/* UNIT có khung điều hướng riêng và không nhận menu ADMIN */}
            <Route element={<UnitLayout />}>
              <Route path="/unit/records" element={<UnitRecords />} />
              <Route path="/unit/notifications" element={<NotificationInbox />} />
            </Route>
          </Route>

        </Route>
      </Route>

      {/* Lỗi 403 */}
      <Route path="/403" element={<StatusPage forbidden />} />

      {/* Tuyến không tồn tại có trạng thái 404 tiếng Việt thay vì mất ngữ cảnh về login */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<StatusPage />} />
    </Routes></Suspense>
  );
}
