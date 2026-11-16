import { useState } from "react";
import { Form, Input, Button, Card, Typography, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useAuth } from "../../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import styles from "./ChangePasswordPage.module.css";

const { Title } = Typography;

export default function ChangePasswordPage() {
  const { changePassword, user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  /** Gửi mật khẩu tới backend sau khi kiểm tra xác nhận, rồi điều hướng theo vai trò đã đăng nhập
   * Mọi lỗi từ backend được hiển thị bằng tiếng Việt và trạng thái tải luôn được kết thúc
   */
  const onFinish = async (values) => {
    if (values.newPassword !== values.confirmPassword) {
      return message.error("Mật khẩu xác nhận không khớp!");
    }
    
    setLoading(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      message.success("Đổi mật khẩu thành công!");
      const defaultRoute = user.role === "ADMIN" ? "/admin/dashboard" : "/unit/records";
      navigate(defaultRoute, { replace: true });
    } catch (error) {
      // Gắn lỗi vào đúng trường nếu backend trả chi tiết, đồng thời giữ thông báo tổng quát
      if (Array.isArray(error.fieldErrors)) {
        form.setFields(error.fieldErrors.map((item) => ({ name: item.field, errors: item.messages ?? [] })));
      }
      message.error(error.message || "Đổi mật khẩu thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <Title level={3}>Đổi Mật Khẩu</Title>
          <p className={styles.subtitle}>Đây là lần đăng nhập đầu tiên, bạn cần đổi mật khẩu.</p>
        </div>

        <Form form={form} name="change-password" onFinish={onFinish} size="large">
          <Form.Item name="currentPassword" rules={[{ required: true, message: "Vui lòng nhập mật khẩu hiện tại!" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Mật khẩu hiện tại" />
          </Form.Item>

          <Form.Item name="newPassword" rules={[{ required: true, message: "Vui lòng nhập mật khẩu mới!" }, { validator: (_, value) => !value || [...value].length >= 8 ? Promise.resolve() : Promise.reject(new Error("Mật khẩu mới phải có ít nhất 8 ký tự.")) }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Mật khẩu mới" />
          </Form.Item>

          <Form.Item name="confirmPassword" rules={[{ required: true, message: "Vui lòng xác nhận mật khẩu mới!" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Xác nhận mật khẩu mới" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" className={styles.submitBtn} loading={loading}>
              Xác nhận đổi
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}