import apiClient from "./apiClient";
import { getCurrentUser } from "./session";

/** Phân biệt lỗi đã được dịch với ngoại lệ thô từ trình duyệt hoặc nhà cung cấp */
class WebPushError extends Error {}

/** Chỉ giữ lỗi do service tự viết hoặc HTTP đã qua adapter chung với mảng lỗi trường
 * Ngoại lệ PushManager/Notification không có shape này sẽ được thay bằng câu Việt cố định
 */
function safePushError(error) { return error instanceof WebPushError || (Number.isInteger(error?.status) && Array.isArray(error.fieldErrors)); }

/** Dừng ghi subscription nếu tài khoản đổi trong lúc chờ hộp cấp quyền hoặc service worker
 * Mã user chỉ dùng so sánh ổn định phiên, backend vẫn tự xác định chủ sở hữu từ JWT hiện tại
 */
function assertPushSession(expectedId) {
  if (expectedId && getCurrentUser()?.id !== expectedId) throw new WebPushError("Tài khoản đang đăng nhập đã thay đổi, vui lòng thực hiện lại thao tác thông báo đẩy.");
}

/** Chuyển khóa công khai VAPID sang mảng byte để trình duyệt đăng ký thiết bị
 * Đầu vào là chuỗi base64 URL, thêm phần đệm còn thiếu trước khi giải mã
 */
function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

/** Dùng adapter JSON chung để xoay vòng JWT và giữ mã/lỗi trường tiếng Việt cho Web Push
 * accessToken chỉ xác định luồng có phiên, interceptor lấy token mới nhất sau khi người dùng cấp quyền browser
 * Public key và token mời dùng authMode public để không gắn nhầm phiên hoặc đăng xuất người đang mở lời mời
 * Body do chính service serialize, response 204 và envelope được adapter chung xử lý nhất quán
 */
async function requestJson(path, accessToken, options = {}) {
  return apiClient.request({ url: path, method: options.method ?? "GET", data: options.body ? JSON.parse(options.body) : undefined, authMode: accessToken ? "session" : "public" });
}

/** Xin quyền và đăng ký thiết bị với máy chủ cho tài khoản đang đăng nhập
 * Từ chối khi thiếu token, trình duyệt không hỗ trợ hoặc khóa hai phía khác nhau
 * Đăng ký sẵn có được dùng lại để tránh tạo thêm subscription không cần thiết
 */
export async function enableWebPush(accessToken) {
  const expectedUserId = getCurrentUser()?.id;
  try {
  if (!accessToken) {
    throw new WebPushError("Bạn cần đăng nhập để bật thông báo đẩy.");
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new WebPushError("Trình duyệt này không hỗ trợ thông báo đẩy.");
  }
  const publicKeyResponse = await requestJson("/notifications/web-push/public-key");
  if (!publicKeyResponse.enabled || !publicKeyResponse.publicKey) throw new WebPushError("Thông báo đẩy chưa được kích hoạt trên máy chủ.");
  assertPushSession(expectedUserId);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new WebPushError("Bạn chưa cấp quyền nhận thông báo.");
  }

  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKeyResponse.publicKey),
    });
  }

  assertPushSession(expectedUserId);
  await requestJson("/notifications/web-push/subscriptions", accessToken, {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
  return subscription;
  } catch (error) {
    // Giữ lỗi đã dịch và thay lỗi trình duyệt để không lộ nội dung thô
    if (safePushError(error)) throw error;
    throw new WebPushError("Không thể bật thông báo đẩy. Vui lòng thử lại.");
  }
}

/** Mời thiết bị khi người nhận chưa có phiên nghiệp vụ và còn phải đổi mật khẩu
 * Token chỉ lấy từ fragment của link mời, dùng một lần tại endpoint onboarding và không lưu vào storage
 */
export async function enableWebPushWithInvitation(token) {
  try {
    if (!token) throw new WebPushError("Liên kết mời không hợp lệ.");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new WebPushError("Trình duyệt này không hỗ trợ thông báo đẩy.");
    const verified = await requestJson("/onboarding/web-push/verify", null, { method: "POST", body: JSON.stringify({ token }) });
    if (!verified.valid || !verified.publicKey) throw new WebPushError("Liên kết mời không còn hiệu lực.");
    if (await Notification.requestPermission() !== "granted") throw new WebPushError("Bạn chưa cấp quyền nhận thông báo.");
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(verified.publicKey) });
    await requestJson("/onboarding/web-push/subscriptions", null, { method: "POST", body: JSON.stringify({ token, subscription: subscription.toJSON() }) });
    return subscription;
  } catch (error) {
    if (safePushError(error)) throw error;
    throw new WebPushError("Không thể đăng ký thiết bị. Vui lòng thử lại.");
  }
}

/** Hủy đăng ký thiết bị trên máy chủ rồi hủy subscription tại trình duyệt
 * Không có subscription thì kết thúc bình thường, thiếu token thì từ chối thao tác
 */
export async function disableWebPush(accessToken) {
  const expectedUserId = getCurrentUser()?.id;
  try {
  if (!accessToken) {
    throw new WebPushError("Bạn cần đăng nhập để tắt thông báo đẩy.");
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    return;
  }

  assertPushSession(expectedUserId);
  await requestJson("/notifications/web-push/subscriptions/current", accessToken, {
    method: "DELETE",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
  } catch (error) {
    // Giữ lỗi đã dịch và thay lỗi trình duyệt để không lộ nội dung thô
    if (safePushError(error)) throw error;
    throw new WebPushError("Không thể tắt thông báo đẩy. Vui lòng thử lại.");
  }
}
