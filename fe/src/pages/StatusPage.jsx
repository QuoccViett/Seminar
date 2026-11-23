import { Button, Result } from "antd";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

/** Hiển thị lỗi tuyến bằng tiếng Việt và cung cấp đường về đúng vai trò đã xác thực
 * URL không tồn tại không giả thành đăng nhập lỗi, guard vẫn chặn các trang nghiệp vụ
 */
export default function StatusPage({ forbidden = false }) {
  const { user } = useAuth();
  const home = user?.mustChangePassword ? "/change-password" : user?.role === "ADMIN" ? "/admin/dashboard" : user ? "/unit/dashboard" : "/login";
  return <Result status={forbidden ? "403" : "404"} title={forbidden ? "Bạn không có quyền truy cập trang này" : "Không tìm thấy trang được yêu cầu"} subTitle="Vui lòng kiểm tra đường dẫn hoặc trở về trang chính" extra={<Link to={home}><Button type="primary">Về trang chính</Button></Link>} />;
}
