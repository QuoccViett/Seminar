import { expect, test } from "vitest";
import apiClient from "./apiClient";
import { unwrapResponse, normalizeError } from "./apiClient";
import { uploadEvidenceBytes } from "./evidenceService";

/** Adapter không được làm mất tổng/trang khi backend trả danh sách trực tiếp hoặc envelope */
test("giữ pagination qua mọi shape danh sách được hỗ trợ", () => {
  const direct = { items: [{ id: "1" }], page: 2, pageSize: 20, total: 42 };
  expect(unwrapResponse(direct)).toEqual(direct);
  expect(unwrapResponse({ data: direct })).toEqual(direct);
  expect(unwrapResponse({ data: direct.items, meta: { page: 2, pageSize: 20, total: 42 } })).toEqual(direct);
});

/** Field lồng nhau được giữ nguyên định danh nhưng lỗi kỹ thuật thô được thay câu tiếng Việt */
test("không hiển thị lỗi SQL hoặc provider trong details", () => {
  const result = normalizeError({ response: { status: 422, data: { code: "VALIDATION_ERROR", message: "Dữ liệu không hợp lệ", details: [{ field: "items[0].score", messages: ["Prisma SQLSTATE lỗi nội bộ"] }, { messages: "sai cấu trúc" }] } } });
  expect(result.fieldErrors).toEqual([{ field: "items[0].score", messages: ["Dữ liệu trường này không hợp lệ."] }]);
});

/** Token mời có phạm vi riêng không được gửi kèm Bearer của tài khoản đang mở trang */
test("request public không đính kèm phiên nghiệp vụ", async () => {
  const { setSession, clearSession } = await import("./session");
  setSession({ accessToken: "access-nguoi-dang-mo", refreshToken: "refresh-thu" });
  try {
    const attach = apiClient.interceptors.request.handlers[0].fulfilled;
    const config = attach({ url: "/onboarding/web-push/verify", authMode: "public", headers: { Authorization: "Bearer cu", authorization: "Bearer chu-thuong" } });
    expect(config.headers.Authorization).toBeUndefined();
    expect(config.headers.authorization).toBeUndefined();
  } finally { clearSession(); }
});

/** Lời mời sai hoặc hết hạn không được xoay vòng hay xóa phiên của người đang đăng nhập */
test("401 của public onboarding giữ phiên đang mở", async () => {
  const { setSession, getAccessToken, clearSession } = await import("./session");
  setSession({ accessToken: "access-hien-tai", refreshToken: "refresh-hien-tai" });
  try {
    const reject = apiClient.interceptors.response.handlers[0].rejected;
    const failure = await reject({ config: { url: "/onboarding/web-push/verify", authMode: "public" }, response: { status: 401, data: { code: "INVALID_ONBOARDING_TOKEN", message: "Liên kết mời đã hết hạn" } } }).catch((error) => error);
    expect(failure.message).toBe("Liên kết mời đã hết hạn");
    expect(getAccessToken()).toBe("access-hien-tai");
  } finally { clearSession(); }
});

/** Provider ngoài có thể trả tiếng Việt kèm thông tin nội bộ, giao diện chỉ được nhận lỗi cố định
 * Spy chỉ mô phỏng biên provider trong unit test, không được coi là nghiệm thu bucket thật
 */
test("upload không phản chiếu payload provider ngoài", async () => {
  const { default: axios } = await import("axios"); const { vi } = await import("vitest");
  const put = vi.spyOn(axios, "put").mockRejectedValue({ response: { status: 500, data: { code: "INTERNAL_ERROR", message: "Lỗi nội bộ nhà cung cấp có bí mật thử nghiệm" } } });
  try {
    await expect(uploadEvidenceBytes({ uploadUrl: "https://provider.example.invalid/upload", requiredHeaders: {} }, new Blob(["thử"]), () => {})).rejects.toThrow("Không thể tải tệp vào kho, vui lòng thử lại");
    expect(put.mock.calls[0][2].headers.Authorization).toBeUndefined();
  } finally { put.mockRestore(); }
});

/** Capability local vẫn phải giữ lý do từ chối đúng hạn do backend kiểm, không gắn Bearer vào PUT bytes */
test("upload local giữ lỗi quyền đã chuẩn hóa", async () => {
  const { default: axios } = await import("axios"); const { vi } = await import("vitest");
  const put = vi.spyOn(axios, "put").mockRejectedValue({ response: { status: 403, data: { code: "DEADLINE_PASSED", message: "Đã hết thời gian bổ sung hồ sơ", details: [] } } });
  try {
    await expect(uploadEvidenceBytes({ uploadUrl: "/api/v1/evidences/local-upload", requiredHeaders: {} }, new Blob(["thử"]), () => {})).rejects.toThrow("Đã hết thời gian bổ sung hồ sơ");
  } finally { put.mockRestore(); }
});

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

/** Refresh cũ hoàn tất sau khi đăng nhập tài khoản khác phải giữ nguyên cặp token và nháp của phiên mới
 * Chỉ trì hoãn biên Axios trong unit test để tạo thứ tự sự kiện xác định, không thay backend nghiệm thu
 * Lỗi request cũ vẫn được trả về nhưng không phát sự kiện buộc đăng xuất danh tính mới
 */
test("refresh cũ không xóa phiên mới được đăng nhập trong lúc chờ", async () => {
  const { default: axios } = await import("axios"); const { vi } = await import("vitest");
  const { setSession, getAccessToken, getRefreshToken, clearSession } = await import("./session");
  setSession({ accessToken: "access-cu", refreshToken: "refresh-cu", user: { id: "cu" } });
  let complete;
  const post = vi.spyOn(axios, "post").mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const expired = vi.fn(); window.addEventListener("auth:unauthorized", expired);
  try {
    const reject = apiClient.interceptors.response.handlers[0].rejected;
    const oldRequest = reject({ response: { status: 401 }, config: { url: "/evaluations", headers: { Authorization: "Bearer access-cu" } } }).catch((error) => error);
    setSession({ accessToken: "access-dang-nhap-moi", refreshToken: "refresh-dang-nhap-moi", user: { id: "moi" } });
    complete({ data: { accessToken: "access-refresh-cu", refreshToken: "refresh-thay-the-cu", user: { id: "cu" } } });
    await oldRequest;
    expect(getAccessToken()).toBe("access-dang-nhap-moi");
    expect(getRefreshToken()).toBe("refresh-dang-nhap-moi");
    expect(expired).not.toHaveBeenCalled();
  } finally { post.mockRestore(); window.removeEventListener("auth:unauthorized", expired); clearSession(); }
});
