const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const vapidPublicKey = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY;

/** Phân biệt lỗi đã được dịch với ngoại lệ thô từ trình duyệt hoặc nhà cung cấp */
class WebPushError extends Error {}

/** Chuyển khóa công khai VAPID sang mảng byte để trình duyệt đăng ký thiết bị
 * Đầu vào là chuỗi base64 URL, thêm phần đệm còn thiếu trước khi giải mã
 */
function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

/** Gửi yêu cầu Web Push kèm token khi có và chỉ trả dữ liệu JSON khi thành công
 * Lỗi dùng thông báo cố định vì nội dung phản hồi có thể chứa dữ liệu nội bộ
 * Phản hồi 204 không có nội dung nên trả null thay vì phân tích JSON
 */
async function requestJson(path, accessToken, options = {}) {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new WebPushError("Không thể xử lý yêu cầu thông báo đẩy. Vui lòng thử lại.");
  }
  return response.status === 204 ? null : response.json();
}

/** Xin quyền và đăng ký thiết bị với máy chủ cho tài khoản đang đăng nhập
 * Từ chối khi thiếu token, trình duyệt không hỗ trợ hoặc khóa hai phía khác nhau
 * Đăng ký sẵn có được dùng lại để tránh tạo thêm subscription không cần thiết
 */
export async function enableWebPush(accessToken) {
  try {
  if (!accessToken) {
    throw new WebPushError("Bạn cần đăng nhập để bật thông báo đẩy.");
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new WebPushError("Trình duyệt này không hỗ trợ thông báo đẩy.");
  }
  if (!vapidPublicKey) {
    throw new WebPushError("Chưa cấu hình khóa công khai cho thông báo đẩy.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new WebPushError("Bạn chưa cấp quyền nhận thông báo.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  const publicKeyResponse = await requestJson("/notifications/web-push/public-key");
  if (publicKeyResponse.publicKey !== vapidPublicKey) {
    throw new WebPushError("Khóa thông báo đẩy của giao diện và máy chủ không khớp.");
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  await requestJson("/notifications/web-push/subscriptions", accessToken, {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
  return subscription;
  } catch (error) {
    // Giữ lỗi đã dịch và thay lỗi trình duyệt để không lộ nội dung thô
    if (error instanceof WebPushError) throw error;
    throw new WebPushError("Không thể bật thông báo đẩy. Vui lòng thử lại.");
  }
}

/** Hủy đăng ký thiết bị trên máy chủ rồi hủy subscription tại trình duyệt
 * Không có subscription thì kết thúc bình thường, thiếu token thì từ chối thao tác
 */
export async function disableWebPush(accessToken) {
  try {
  if (!accessToken) {
    throw new WebPushError("Bạn cần đăng nhập để tắt thông báo đẩy.");
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    return;
  }

  await requestJson("/notifications/web-push/subscriptions/current", accessToken, {
    method: "DELETE",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
  } catch (error) {
    // Giữ lỗi đã dịch và thay lỗi trình duyệt để không lộ nội dung thô
    if (error instanceof WebPushError) throw error;
    throw new WebPushError("Không thể tắt thông báo đẩy. Vui lòng thử lại.");
  }
}
