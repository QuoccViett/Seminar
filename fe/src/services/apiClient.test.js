import { expect, test } from "vitest";
import apiClient from "./apiClient";

/** Kiểm tra lỗi trường từ backend được giữ để form hiển thị đúng vị trí
 * Token và body giả trong lỗi Axios không được đưa vào đối tượng trả cho giao diện
 */
test("giữ lỗi tiếng Việt và loại bỏ dữ liệu xác thực của Axios", async () => {
  const reject = apiClient.interceptors.response.handlers[0].rejected;
  const source = {
    config: { headers: { Authorization: "token-thu" }, data: "mat-khau-thu" },
    response: { status: 400, data: { code: "VALIDATION_ERROR", message: "Dữ liệu gửi lên không hợp lệ.", details: [{ field: "username", messages: ["Tên đăng nhập là bắt buộc."] }] } },
  };
  const result = await reject(source).catch((error) => error);
  expect(result.fieldErrors[0].field).toBe("username");
  expect(result.message).toBe("Dữ liệu gửi lên không hợp lệ.");
  expect(JSON.stringify(result)).not.toMatch(/token-thu|mat-khau-thu/);
});

/** Kiểm tra lỗi mạng không có phản hồi vẫn trả câu tiếng Việt thay cho lỗi Axios thô */
test("chuẩn hóa lỗi mất kết nối", async () => {
  const reject = apiClient.interceptors.response.handlers[0].rejected;
  const result = await reject({ message: "Network Error" }).catch((error) => error);
  expect(result.message).toBe("Không thể kết nối máy chủ. Vui lòng thử lại.");
});

/** Hai phản hồi 401 đồng thời phải dùng chung một lần làm mới và mỗi yêu cầu được thử lại
 * Bộ điều hợp giả chỉ mô phỏng mạng tại biên Axios, không thay thế kiểm thử backend thật
 */
test("các yêu cầu đồng thời chỉ xoay vòng phiên một lần", async () => {
  const { default: axios } = await import("axios");
  const { vi } = await import("vitest");
  const { setSession, clearSession } = await import("./session");
  setSession({ accessToken: "access-cu", refreshToken: "refresh-cu", user: { id: "1" } });
  let finishRefresh;
  const pending = new Promise((resolve) => { finishRefresh = resolve; });
  const post = vi.spyOn(axios, "post").mockReturnValue(pending);
  const reject = apiClient.interceptors.response.handlers[0].rejected;
  const adapter = async (config) => ({ data: { ok: true }, status: 200, statusText: "OK", headers: {}, config });
  const failure = () => ({ response: { status: 401 }, config: { url: "/users", headers: { Authorization: "Bearer access-cu" }, adapter } });
  try {
    const requests = [reject(failure()), reject(failure())];
    finishRefresh({ data: { accessToken: "access-moi", refreshToken: "refresh-moi", user: { id: "1" } } });
    const results = await Promise.all(requests);
    expect(post).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
  } finally {
    post.mockRestore();
    clearSession();
  }
});
