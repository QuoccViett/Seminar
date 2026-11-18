import { Component } from "react";
import { Button, Result } from "antd";

/** Chặn lỗi render ngoài dự kiến để người dùng có câu tiếng Việt và đường phục hồi
 * Không hiển thị lỗi hoặc stack kỹ thuật, tải lại sẽ xác thực quyền bằng backend như lần mở mới
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  /** Đánh dấu giao diện cần phục hồi, không đưa ngoại lệ có thể chứa dữ liệu vào state */
  static getDerivedStateFromError() { return { failed: true }; }

  /** Giữ cây con khi bình thường, lỗi chỉ cung cấp nút tải lại có chủ đích */
  render() {
    return this.state.failed ? <Result status="error" title="Không thể hiển thị trang lúc này" subTitle="Vui lòng tải lại để khôi phục phiên và dữ liệu từ máy chủ" extra={<Button onClick={() => window.location.reload()}>Tải lại trang</Button>} /> : this.props.children;
  }
}
