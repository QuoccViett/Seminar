import { useCallback, useEffect, useState } from "react";
import { CHANNEL_LABELS, displayLabel, deliveryDescription, notificationBody } from "../services/displayLabels";
import { Alert, Button, Card, List, Modal, Pagination, Space, Switch, Tag, Typography, message } from "antd";
import { createTestNotification, getNotificationDeliveries, getNotificationPreferences, listNotifications, markAllNotificationsRead, markNotificationRead, updateNotificationPreferences } from "../services/notificationService";
import { enableWebPush, disableWebPush } from "../services/webPush";
import { getAccessToken } from "../services/session";

const { Text, Title } = Typography;
const OPTIONAL_CHANNELS = ["WEB_PUSH", "EMAIL", "ZALO_ZNS"];

/** Hiển thị hộp thư thật và tùy chọn kênh cho phiên đang đăng nhập
 * Tải lại khi quay về tab để giảm độ trễ; mọi kết quả quyền và trạng thái ZNS do backend quyết định
 */
export default function NotificationInbox() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState({ items: [], total: 0, pageSize: 20 });
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const available = (channel) => channel === "WEB_PUSH" ? preferences?.webPushAvailable !== false
    : channel === "EMAIL" ? preferences?.emailAvailable !== false : Boolean(preferences?.zaloZnsAvailable);

  /** Tải danh sách và tùy chọn độc lập để lỗi một phần vẫn hiện rõ, không hiển thị dữ liệu giả */
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [inbox, settings] = await Promise.all([
        listNotifications({ page, pageSize: 20, ...(filter === "all" ? {} : { isRead: filter }) }),
        getNotificationPreferences(),
      ]);
      setData(inbox);
      setPreferences(settings);
    } catch (failure) {
      setError(failure.message || "Không thể tải hộp thư thông báo.");
    } finally { setLoading(false); }
  }, [page, filter]);

  /** Tải khi đổi trang hoặc bộ lọc và khi tab lấy lại tiêu điểm; dọn listener khi unmount */
  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load]);

  /** Ghi một kênh rồi dùng phản hồi backend làm nguồn trạng thái, kể cả khi ZNS bị từ chối */
  async function changeChannel(channel, enabled) {
    setBusy(true);
    try {
      // Bật Push chỉ khi trình duyệt đã đăng ký thành công với backend theo đúng phiên hiện tại
      if (channel === "WEB_PUSH" && enabled) await enableWebPush(getAccessToken());
      if (channel === "WEB_PUSH" && !enabled) await disableWebPush(getAccessToken());
      setPreferences(await updateNotificationPreferences({ [channel]: enabled }));
      message.success("Đã cập nhật tùy chọn thông báo.");
    } catch (failure) { message.error(failure.message || "Không thể cập nhật tùy chọn thông báo."); }
    finally { setBusy(false); }
  }

  /** Đăng ký thêm thiết bị khi preference đã bật nhưng tài khoản chưa có subscription trên máy này */
  async function registerCurrentDevice() {
    setBusy(true);
    try { await enableWebPush(getAccessToken()); message.success("Đã đăng ký thiết bị nhận thông báo đẩy."); }
    catch (failure) { message.error(failure.message || "Không thể đăng ký thiết bị."); }
    finally { setBusy(false); }
  }

  /** Tạo thông báo thử trong DB rồi tải lại; không mô tả xếp hàng là đã gửi thành công */
  async function testChannel(channel) {
    setBusy(true);
    try {
      await createTestNotification(channel);
      message.success("Đã tiếp nhận thông báo kiểm tra.");
      await load();
      window.dispatchEvent(new Event("notifications:changed"));
    } catch (failure) { message.error(failure.message || "Không thể tạo thông báo kiểm tra."); }
    finally { setBusy(false); }
  }

  /** Đánh dấu một bản ghi và lấy lại danh sách từ server để số chưa đọc nhất quán */
  async function readOne(id) {
    try { await markNotificationRead(id); await load(); window.dispatchEvent(new Event("notifications:changed")); }
    catch (failure) { message.error(failure.message || "Không thể đánh dấu thông báo."); }
  }

  /** Đọc toàn bộ hộp thư của mình; backend tính số cập nhật thay vì FE tự suy ra */
  async function readAll() {
    try { await markAllNotificationsRead(); await load(); window.dispatchEvent(new Event("notifications:changed")); }
    catch (failure) { message.error(failure.message || "Không thể đánh dấu tất cả thông báo."); }
  }

  /** Xem kết quả thật của worker theo kênh; SENT chỉ nghĩa nhà cung cấp đã tiếp nhận request */
  async function showDeliveries(id) {
    try {
      const result = await getNotificationDeliveries(id);
      Modal.info({ title: "Trạng thái gửi thông báo", content: <Space direction="vertical">{result.channels.length ? result.channels.map((item) => <Text key={item.channel}>{displayLabel(CHANNEL_LABELS, item.channel, "Kênh khác")}: {deliveryDescription(item)}</Text>) : <Text>Chỉ có thông báo trong hộp thư hệ thống.</Text>}</Space>, okText: "Đóng" });
    } catch (failure) { message.error(failure.message || "Không thể tải trạng thái gửi thông báo."); }
  }

  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Title level={3}>Hộp thư thông báo</Title>
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={load}>Thử lại</Button>} />}
    <Card title="Tùy chọn nhận thông báo" extra={<Button onClick={() => testChannel("SYSTEM")} disabled={busy}>Kiểm tra hộp thư</Button>}>
      <Space direction="vertical" size="middle">
        <Text>Hộp thư hệ thống luôn bật</Text>
        {OPTIONAL_CHANNELS.map((channel) => <Space key={channel}>
          <Switch checked={available(channel) && Boolean(preferences?.[channel])} disabled={busy || !preferences || !available(channel)} onChange={(enabled) => changeChannel(channel, enabled)} aria-label={CHANNEL_LABELS[channel]} />
          <Text>{CHANNEL_LABELS[channel]}</Text>
          {channel === "WEB_PUSH" && available(channel) && preferences?.WEB_PUSH && <Button size="small" disabled={busy} onClick={registerCurrentDevice}>Đăng ký thiết bị này</Button>}
          {!available(channel) ? <Tag>{channel === "ZALO_ZNS" ? "Chưa kích hoạt" : "Chưa kích hoạt trên máy chủ"}</Tag> : <Button size="small" disabled={busy || !preferences?.[channel]} onClick={() => testChannel(channel)}>Thử kênh</Button>}
        </Space>)}
      </Space>
    </Card>
    <Card title="Thông báo" extra={<Space>
      <Button onClick={() => { setPage(1); setFilter(filter === "false" ? "all" : "false"); }}>{filter === "false" ? "Xem tất cả" : "Chưa đọc"}</Button>
      <Button onClick={readAll}>Đánh dấu đã đọc tất cả</Button>
    </Space>}>
      <List loading={loading} locale={{ emptyText: "Chưa có thông báo." }} dataSource={data.items} renderItem={(item) => <List.Item actions={[<Button key="delivery" type="link" onClick={() => showDeliveries(item.id)}>Trạng thái gửi</Button>, ...(!item.isRead ? [<Button key="read" type="link" onClick={() => readOne(item.id)}>Đánh dấu đã đọc</Button>] : [])]}>
        <List.Item.Meta title={<Space><Text strong={!item.isRead}>{item.title}</Text>{!item.isRead && <Tag color="blue">Mới</Tag>}</Space>} description={<Space direction="vertical"><Text>{notificationBody(item)}</Text><Text type="secondary">{new Date(item.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</Text></Space>} />
      </List.Item>} />
      <Pagination current={page} pageSize={data.pageSize} total={data.total} onChange={setPage} showSizeChanger={false} />
    </Card>
  </Space>;
}
