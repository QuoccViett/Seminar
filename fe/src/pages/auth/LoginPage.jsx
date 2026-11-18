import { useState } from "react";
import { Form, Input, Button, Card, Typography, message, Alert } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useAuth } from "../../contexts/AuthContext";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import styles from "./LoginPage.module.css"; 
import { applyFormError } from "../../services/formErrors";

const { Title } = Typography;

/** Đăng nhập bằng API thật, giữ lỗi trường và chỉ trở lại URL nội bộ đúng vai trò
 * Cờ buộc đổi mật khẩu từ backend luôn ưu tiên đường dẫn người dùng muốn mở
 */
export default function LoginPage() {
  const { login, user, sessionMessage } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  /** Giữ cả query của direct URL sau đăng nhập, bỏ đường dẫn thuộc vai trò khác */
  const destination = (identity) => {
    if (identity.mustChangePassword) return "/change-password";
    const prefix = identity.role === "ADMIN" ? "/admin/" : "/unit/";
    const from = location.state?.from;
    return from?.pathname?.startsWith(prefix) ? `${from.pathname}${from.search ?? ""}` : identity.role === "ADMIN" ? "/admin/dashboard" : "/unit/records";
  };

  if (user) {
    return <Navigate to={destination(user)} replace />;
  }

  /** Gửi username/password, chờ danh tính server và hiển thị cả lỗi tổng lẫn lỗi trường */
  const onFinish = async (values) => {
    setLoading(true);
    try {
      const loggedUser = await login(values.username, values.password);
      if (loggedUser.mustChangePassword) {
        navigate("/change-password", { replace: true });
      } else {
        navigate(destination(loggedUser), { replace: true });
      }
    } catch (error) {
      message.error(applyFormError(form, error, "Đăng nhập thất bại"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <Title level={3}>Đăng Nhập Hệ Thống</Title>
        </div>

        {/* Thông báo trong Auth sống qua điều hướng guard, location chỉ bổ sung lời nhắc từ trang trước */}
        {(sessionMessage || location.state?.message) && (
          <Alert title={sessionMessage || location.state.message} type="warning" showIcon className={styles.alert} />
        )}

        <Form form={form} name="login" onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: "Vui lòng nhập tên đăng nhập!" }]}>
            <Input prefix={<UserOutlined />} placeholder="Tên đăng nhập" autoComplete="username" />
          </Form.Item>

          <Form.Item name="password" rules={[{ required: true, message: "Vui lòng nhập mật khẩu!" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Mật khẩu" autoComplete="current-password" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" className={styles.submitBtn} loading={loading}>
              Đăng nhập
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
