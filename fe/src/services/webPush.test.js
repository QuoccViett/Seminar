import { afterEach, expect, test, vi } from "vitest";
import { disableWebPush, enableWebPush } from "./webPush";

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
