import { useEffect, useState } from "react";
import { Alert } from "antd";

/** Nhắc trước hạn access token dựa thời lượng server cấp, interceptor tiếp tục xoay vòng khi cần
 * Đây chỉ là nhãn thông tin, không khóa thao tác hay cấp quyền bằng đồng hồ thiết bị
 * Sự kiện session cập nhật nhãn ngay khi backend trả cặp token thay thế
 */
export default function SessionNotice() {
  const [warning, setWarning] = useState(false);
  useEffect(() => {
    const update = () => { const expiry = Number(sessionStorage.getItem("sessionExpiresAt")); setWarning(expiry > 0 && expiry - Date.now() < 120000); };
    update(); const timer = setInterval(update, 30000);
    window.addEventListener("auth:session", update);
    return () => { clearInterval(timer); window.removeEventListener("auth:session", update); };
  }, []);
  return warning ? <Alert type="warning" showIcon title="Phiên truy cập sắp hết hạn, hệ thống sẽ thử làm mới khi bạn tiếp tục thao tác" /> : null;
}
