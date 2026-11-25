import { afterEach, expect, test, vi } from "vitest";
import { disableWebPush, enableWebPush, enableWebPushWithInvitation } from "./webPush";
import apiClient from "./apiClient";

vi.mock("./apiClient", () => ({ default: { request: vi.fn() } }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); sessionStorage.clear(); });

/** Kiểm tra thiếu phiên được báo bằng tiếng Việt trước khi dùng API trình duyệt
 * Không cần tạo subscription hoặc gửi thông báo đến người thật
 */
test("thiếu token được thông báo rõ ràng", async () => {
  await expect(enableWebPush("")).rejects.toThrow("Bạn cần đăng nhập để bật thông báo đẩy.");
});

/** Lỗi thô từ trình duyệt được thay bằng thông báo an toàn khi hủy đăng ký
 * Dữ liệu nhạy cảm giả trong ngoại lệ không được xuất hiện trong câu hiển thị
 */
test("không lộ lỗi trình duyệt khi tắt thông báo", async () => {
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn().mockRejectedValue(new Error("provider secret-test")) } });
  await expect(disableWebPush("token-thu")).rejects.toThrow("Không thể tắt thông báo đẩy. Vui lòng thử lại.");
});

test("kiểm máy chủ trước khi xin quyền hoặc đăng ký service worker", async () => {
  const requestPermission = vi.fn();
  const register = vi.fn();
  vi.stubGlobal("Notification", { requestPermission });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  apiClient.request.mockResolvedValue({ enabled: false, publicKey: null });
  await expect(enableWebPush("token-thu")).rejects.toThrow("Thông báo đẩy chưa được kích hoạt trên máy chủ.");
  expect(requestPermission).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});

test("chờ service worker hoạt động trước khi đăng ký PushManager", async () => {
  const subscription = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fixture", keys: { auth: "fixture", p256dh: "fixture" } }) };
  const subscribe = vi.fn().mockResolvedValue(subscription);
  let activate;
  const ready = new Promise(resolve => { activate = resolve; });
  vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn().mockResolvedValue({ active: null }), ready } });
  apiClient.request.mockResolvedValueOnce({ enabled: true, publicKey: "AQID" }).mockResolvedValueOnce({ registered: true });
  const pending = enableWebPush("token-thu");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(subscribe).not.toHaveBeenCalled();
  activate({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe } });
  await expect(pending).resolves.toBe(subscription);
  expect(subscribe).toHaveBeenCalledOnce();
});

/** Người dùng từ chối quyền thì không được tạo service worker hoặc subscription */
test("từ chối permission không đăng ký thiết bị", async () => {
  const register = vi.fn();
  vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("denied") });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  apiClient.request.mockResolvedValue({ enabled: true, publicKey: "AQID" });
  await expect(enableWebPush("token-thu")).rejects.toThrow("Bạn chưa cấp quyền nhận thông báo.");
  expect(register).not.toHaveBeenCalled();
  expect(apiClient.request).toHaveBeenCalledTimes(1);
});

/** Hộp cấp quyền có thể mở lâu, người đổi tài khoản không được gắn nhầm thiết bị */
test("đổi tài khoản khi đang cấp quyền không ghi subscription cho phiên mới", async () => {
  sessionStorage.setItem("currentUser", JSON.stringify({ id: "nguoi-ban-dau" }));
  const subscription = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fixture" }) };
  vi.stubGlobal("Notification", { requestPermission: vi.fn().mockImplementation(async () => {
    sessionStorage.setItem("currentUser", JSON.stringify({ id: "nguoi-khac" }));
    return "granted";
  }) });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn().mockResolvedValue({}), ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } }) } });
  apiClient.request.mockResolvedValue({ enabled: true, publicKey: "AQID" });
  await expect(enableWebPush("token-thu")).rejects.toThrow("Tài khoản đang đăng nhập đã thay đổi");
  expect(apiClient.request).toHaveBeenCalledTimes(1);
});

/** Token mời hết hạn phải bị từ chối trước bước xin permission trên thiết bị */
test("lời mời hết hiệu lực không xin quyền trình duyệt", async () => {
  const requestPermission = vi.fn();
  vi.stubGlobal("Notification", { requestPermission });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("navigator", { serviceWorker: {} });
  apiClient.request.mockResolvedValue({ valid: false });
  await expect(enableWebPushWithInvitation("loi-moi-thu")).rejects.toThrow("Liên kết mời không còn hiệu lực.");
  expect(requestPermission).not.toHaveBeenCalled();
});

/** Lời mời có quyền hẹp, không đính phiên đăng nhập hiện tại vào hai request public */
test("đăng ký lời mời dùng subscription có sẵn và không gắn JWT", async () => {
  sessionStorage.setItem("currentUser", JSON.stringify({ id: "admin-dang-dang-nhap" }));
  const subscription = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fixture", keys: { auth: "fixture", p256dh: "fixture" } }) };
  const subscribe = vi.fn();
  vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn().mockResolvedValue({}), ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe } }) } });
  apiClient.request.mockResolvedValueOnce({ valid: true, publicKey: "AQID" }).mockResolvedValueOnce({ registered: true });
  await expect(enableWebPushWithInvitation("loi-moi-thu")).resolves.toBe(subscription);
  expect(subscribe).not.toHaveBeenCalled();
  expect(apiClient.request.mock.calls.map(([request]) => request.authMode)).toEqual(["public", "public"]);
  expect(apiClient.request).toHaveBeenLastCalledWith(expect.objectContaining({ url: "/onboarding/web-push/subscriptions", data: { token: "loi-moi-thu", subscription: subscription.toJSON() } }));
});

/** Nếu BE chưa thu hồi được, giữ subscription tại máy để người dùng còn có thể thử lại */
test("lỗi thu hồi trên máy chủ không xóa subscription cục bộ", async () => {
  const unsubscribe = vi.fn();
  const failure = Object.assign(new Error("Không thể thu hồi thiết bị."), { status: 503, fieldErrors: [] });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue({ endpoint: "https://fcm.googleapis.com/fixture", unsubscribe }) } }) } });
  apiClient.request.mockRejectedValue(failure);
  await expect(disableWebPush("token-thu")).rejects.toBe(failure);
  expect(unsubscribe).not.toHaveBeenCalled();
});
