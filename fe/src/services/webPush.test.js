import { afterEach, expect, test, vi } from "vitest";
import { disableWebPush, enableWebPush } from "./webPush";
import apiClient from "./apiClient";

vi.mock("./apiClient", () => ({ default: { request: vi.fn() } }));

afterEach(() => vi.unstubAllGlobals());

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
