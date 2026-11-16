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
