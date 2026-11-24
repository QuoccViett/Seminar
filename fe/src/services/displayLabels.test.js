import { expect, test } from "vitest";
import { deliveryDescription, displayLabel, notificationBody, RATING_LABELS, ratingLabel, systemMessage } from "./displayLabels";
import { normalizeError } from "./apiClient";

/** Giữ danh tính lỗi để form gắn đúng control, chỉ thay field/enum trong câu hiển thị */
test("lỗi API giữ mã và đường dẫn trường nhưng hiển thị tiếng Việt", () => {
  const result = normalizeError({ response: { status: 422, data: { code: "VALIDATION_ERROR", message: "supplementDeadline phải sau supplementStartAt.", details: [{ field: "thresholds[0].minPercent", messages: ["Ngưỡng EXCELLENT phải lớn hơn GOOD."] }] } } });
  expect(result).toMatchObject({ code: "VALIDATION_ERROR", message: "Hạn bổ sung phải sau Ngày giờ mở bổ sung.", fieldErrors: [{ field: "thresholds[0].minPercent", messages: ["Ngưỡng Xuất sắc phải lớn hơn Tốt."] }] });
  expect(systemMessage("Email không hợp lệ.")).toBe("Email không hợp lệ.");
  expect(systemMessage("UNIT_INACTIVE", "Đơn vị chưa thể sử dụng")).toBe("Đơn vị chưa thể sử dụng");
});

/** Trạng thái phải phản ánh đang chờ và nguyên nhân, không đổi thiếu thiết bị thành đã gửi */
test("delivery phân biệt chờ xác nhận, thiếu thiết bị, thất bại và provider lạ", () => {
  expect(deliveryDescription({ status: "PENDING", errorCode: "EMAIL_UNCONFIRMED" })).toBe("Đang chờ xử lý · Chưa xác nhận địa chỉ email nhận thông tin đăng nhập");
  expect(deliveryDescription({ status: "SKIPPED", errorCode: "NO_SUBSCRIPTION" })).toBe("Đã bỏ qua · Chưa đăng ký thiết bị nhận thông báo");
  expect(deliveryDescription({ status: "FAILED", reasonCode: "PROVIDER_ERROR", lastError: "SMTP stack trace" })).toBe("Gửi thất bại · Không thể gửi qua kênh này");
  expect(deliveryDescription({ status: "FAILED", reasonCode: "RATE_LIMIT" })).not.toMatch(/hệ thống sẽ thử lại/u);
  expect(deliveryDescription({ status: "NEW_STATUS", errorCode: "UNKNOWN_PROVIDER_CODE" })).not.toMatch(/NEW_STATUS|UNKNOWN_PROVIDER_CODE/);
  expect(deliveryDescription()).toBe("Chưa xếp hàng");
});

/** Nhãn tùy chỉnh phải đi theo kỳ và mã chốt, không dùng nhãn tự chấm khác rating */
test("xếp loại ưu tiên nhãn của kỳ và có dự phòng khi chỉ nhận mã", () => {
  expect(ratingLabel("GOOD", null, [{ rating: "GOOD", label: "Hoàn thành tốt nhiệm vụ" }])).toBe("Hoàn thành tốt nhiệm vụ");
  expect(ratingLabel("GOOD", "Nhãn chính thức")).toBe("Nhãn chính thức");
  expect(ratingLabel("GOOD")).toBe("Tốt");
  expect(ratingLabel("FUTURE_RATING")).toBe("Chưa có xếp loại");
  expect(displayLabel(RATING_LABELS, "toString", "Chưa xác định")).toBe("Chưa xác định");
});

/** Dữ liệu seed cũ phải đọc được mà không sửa DB hoặc đổi nội dung của thông báo khác */
test("dịch hậu tố thông báo trạng thái mẫu và giữ tên đăng nhập trùng enum", () => {
  const item = { type: "EVALUATION_STATUS_CHANGED", body: "Hồ sơ của GOOD đang ở trạng thái FINALIZED." };
  expect(notificationBody(item)).toBe("Hồ sơ của GOOD đang ở trạng thái Đã chốt.");
  expect(notificationBody({ ...item, type: "GENERAL" })).toBe(item.body);
});
