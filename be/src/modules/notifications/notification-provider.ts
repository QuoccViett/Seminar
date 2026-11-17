/** Mô tả một lượt gửi độc lập theo kênh, chỉ chứa nội dung thông báo công khai và người nhận đã chọn từ DB
 * Provider thật ở VC06 sẽ tự giải quyết email, subscription hoặc số điện thoại từ userId
 */
export interface NotificationSendRequest {
  userId: string;
  notificationId: string;
  title: string;
  body: string;
  refType: string | null;
  refId: string | null;
}

/** Kết quả đã chuẩn hóa để worker không lưu lỗi thô từ SQL, SMTP hoặc dịch vụ ngoài
 * Lỗi có thể thử lại giữ PENDING; lỗi vĩnh viễn kết thúc ở SKIPPED
 */
export type NotificationSendResult =
  | { kind: "sent"; providerMessageId?: string }
  | { kind: "retry"; reasonCode: string; message: string }
  | { kind: "skip"; reasonCode: string; message: string };

/** Điểm mở rộng cho đúng ba kênh; resolveRecipient báo thiếu địa chỉ mà không tiết lộ địa chỉ ra log
 * send chỉ chạy sau khi transaction tạo thông báo đã commit
 */
export interface NotificationProvider {
  readonly channel: "WEB_PUSH" | "EMAIL" | "ZALO_ZNS";
  resolveRecipient(userId: string): Promise<boolean>;
  send(request: NotificationSendRequest): Promise<NotificationSendResult>;
}

/** Token DI cho provider giả trong test và provider thật được thêm ở VC06 */
export const NOTIFICATION_PROVIDERS = Symbol("NOTIFICATION_PROVIDERS");
