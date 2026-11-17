import { useEffect, useState } from "react";
import { Alert, Button, Card, Typography } from "antd";
import { enableWebPushWithInvitation } from "../../services/webPush";

/** Gắn thiết bị của người được mời trước khi họ có thể truy cập ứng dụng
 * Fragment được xóa khỏi URL ngay khi đọc để không xuất hiện trong lịch sử điều hướng hoặc request HTTP
 */
export default function PushOnboardingPage() {
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    return value;
  });
  const [state, setState] = useState({ busy: false, message: "", success: false });

  /** Đăng ký bằng token một lần sau khi người dùng chủ động xin quyền trình duyệt
   * Phản hồi lỗi chỉ hiển thị câu tiếng Việt, thành công hướng người dùng tới đăng nhập và đổi mật khẩu
   */
  async function register() {
    setState({ busy: true, message: "", success: false });
    try {
      await enableWebPushWithInvitation(token);
      setState({ busy: false, message: "Đã đăng ký thiết bị nhận thông báo. Hãy đăng nhập và đổi mật khẩu ban đầu.", success: true });
    } catch (error) { setState({ busy: false, message: error.message || "Không thể đăng ký thiết bị.", success: false }); }
  }

  /** Không tự xin permission khi vừa mở link để người nhận nhận biết thao tác bảo mật */
  useEffect(() => { if (!token) setState({ busy: false, message: "Liên kết mời không hợp lệ.", success: false }); }, [token]);

  return <Card style={{ maxWidth: 520, margin: "5rem auto" }} title="Đăng ký thông báo đẩy">
    <Typography.Paragraph>Chỉ đăng ký trên thiết bị của chính bạn. Sau khi đăng ký, hãy đăng nhập và đổi mật khẩu ban đầu.</Typography.Paragraph>
    {state.message && <Alert type={state.success ? "success" : "error"} message={state.message} showIcon style={{ marginBottom: 16 }} />}
    <Button type="primary" loading={state.busy} disabled={!token || state.success} onClick={register}>Đăng ký thiết bị này</Button>
    {state.success && <Button href="/login" style={{ marginLeft: 8 }}>Đến đăng nhập</Button>}
  </Card>;
}
