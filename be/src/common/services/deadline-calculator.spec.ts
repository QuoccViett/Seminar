import assert from "node:assert/strict";
import { test } from "node:test";
import { DeadlineCalculator } from "./deadline-calculator.js";

const calculator = new DeadlineCalculator({ now: () => new Date("2026-11-18T00:00:00.000Z") } as never);

/** So sánh các mốc mẫu của phương án tạm bằng instant UTC tương ứng với giờ Việt Nam
 * Mỗi đầu vào là một ngày mở hợp lệ từ thứ Hai đến thứ Sáu
 * Kỳ vọng thứ Hai đến thứ Năm kết thúc hết ngày kế tiếp, còn thứ Sáu kết thúc trong ngày
 */
test("lịch bổ sung tạm tính hạn cuối tuần theo ngày mở Việt Nam", () => {
  const examples = [
    ["2026-11-16T00:00:00.000Z", "2026-11-17T17:00:00.000Z"],
    ["2026-11-17T00:00:00.000Z", "2026-11-18T17:00:00.000Z"],
    ["2026-11-18T00:00:00.000Z", "2026-11-19T17:00:00.000Z"],
    ["2026-11-19T00:00:00.000Z", "2026-11-20T17:00:00.000Z"],
    ["2026-11-20T00:00:00.000Z", "2026-11-20T17:00:00.000Z"],
  ];
  for (const [start, expected] of examples) {
    assert.equal(calculator.supplementDeadline(new Date(start!)).toISOString(), expected);
  }
});

/** Không tự chuyển ngày cuối tuần sang thứ Hai và từ chối ngày không hợp lệ
 * Hai ngày cuối tuần được biểu diễn theo giờ UTC tương ứng với giờ Việt Nam
 * Lỗi có status HTTP 400 và câu tiếng Việt do service quản lý
 */
test("lịch bổ sung tạm từ chối cuối tuần và ngày không hợp lệ", () => {
  for (const value of ["2026-11-21T00:00:00.000Z", "2026-11-22T00:00:00.000Z", "invalid"]) {
    assert.throws(() => calculator.supplementDeadline(new Date(value)), (error: unknown) =>
      (error as { getStatus(): number }).getStatus() === 400,
    );
  }
});

/** Giữ đúng phút mở trong lịch nhưng kết thúc vào ranh giới nửa đêm loại trừ
 * Thứ Sáu lúc 23:30 giờ Việt Nam còn ba mươi phút đến deadline dự kiến
 * Kết quả không cộng giờ liên tục từ lúc mở
 */
test("lịch bổ sung thứ Sáu mở muộn vẫn hết hạn lúc nửa đêm Việt Nam", () => {
  assert.equal(calculator.supplementDeadline(new Date("2026-11-20T16:30:00.000Z")).toISOString(), "2026-11-20T17:00:00.000Z");
  assert.equal(calculator.supplementDeadline(new Date("2026-11-20T16:59:00.000Z")).toISOString(), "2026-11-20T17:00:00.000Z");
});

/** Kiểm tra lịch qua năm và giữ nguyên đầu vào khi tính nhiều lần
 * Thứ Năm cuối năm tại Việt Nam phải kết thúc sau hết thứ Sáu đầu năm kế tiếp
 * Cùng một Date phải cho cùng kết quả dù người gọi tái sử dụng đối tượng
 */
test("lịch bổ sung qua năm không thay đổi đầu vào", () => {
  const start = new Date("2026-12-31T00:00:00.000Z");
  for (let index = 0; index < 2; index += 1) {
    assert.equal(calculator.supplementDeadline(start).toISOString(), "2027-01-01T17:00:00.000Z");
    assert.equal(start.toISOString(), "2026-12-31T00:00:00.000Z");
  }
});

/** Khóa quyền INITIAL tại deadline hoặc giai đoạn terminal dù scheduler chưa chạy
 * Clock truyền vào xác định biên, DRAFT ở SETUP vẫn được mở đúng start khi job trễ
 * Hồ sơ nộp sớm hoặc đã chuyển review không thể sửa lại trong cửa sổ lịch còn lại
 */
test("quyền tự chấm dùng cửa sổ nửa mở và không mở lại các giai đoạn review", () => {
  const start = new Date("2026-11-21T16:30:00Z");
  const deadline = new Date("2026-11-21T17:00:00Z");
  const window = { publishedAt: new Date(start.getTime() - 1000), selfEvalStart: start, selfEvalDeadline: deadline, phase: "SETUP" };
  assert.equal(calculator.canSelfEvaluate(window, "DRAFT", new Date(start.getTime() - 1)), false);
  assert.equal(calculator.canSelfEvaluate(window, "DRAFT", start), true);
  assert.equal(calculator.canSelfEvaluate(window, "DRAFT", new Date(deadline.getTime() - 1)), true);
  assert.equal(calculator.canSelfEvaluate(window, "DRAFT", deadline), false);
  assert.equal(calculator.canSelfEvaluate(window, "PENDING_REVIEW", start), false);
  assert.equal(calculator.canSelfEvaluate({ ...window, publishedAt: null }, "DRAFT", start), false);
  for (const phase of ["FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW", "CLOSED"]) {
    assert.equal(calculator.canSelfEvaluate({ ...window, phase }, "DRAFT", start), false);
  }
});
