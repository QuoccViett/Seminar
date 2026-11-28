import assert from "node:assert/strict";
import { test } from "node:test";
import { DeadlineCalculator, isDeadlineReminderDue } from "./deadline-calculator.js";

const calculator = new DeadlineCalculator({ now: () => new Date("2026-11-18T00:00:00.000Z") } as never);

test("nhắc tại nửa thời lượng, tối đa 24 giờ trước hạn và không nhắc ngoài cửa sổ", () => {
  const start = new Date("2026-11-18T00:00:00Z");
  for (const [minutes, remaining] of [[10, 5], [30, 15], [120, 60], [2879, 1439.5], [2880, 1440], [4320, 1440]]) {
    const deadline = new Date(+start + minutes! * 60_000);
    const due = +deadline - remaining! * 60_000;
    assert.equal(isDeadlineReminderDue(start, deadline, start), false);
    assert.equal(isDeadlineReminderDue(start, deadline, new Date(due - 1)), false);
    assert.equal(isDeadlineReminderDue(start, deadline, new Date(due)), true);
    assert.equal(isDeadlineReminderDue(start, deadline, new Date(+deadline - 1)), true);
    assert.equal(isDeadlineReminderDue(start, deadline, deadline), false);
    assert.equal(isDeadlineReminderDue(start, deadline, new Date(+deadline + 1)), false);
  }
  for (const end of [null, start, new Date(+start - 1), new Date("invalid")]) {
    assert.equal(isDeadlineReminderDue(start, end, start), false);
  }
  assert.equal(isDeadlineReminderDue(null, start, start), false);
});

/** Mọi ngày trong tuần và mọi thời lượng dương giữ nguyên hai mốc Admin chọn */
test("lịch bổ sung giữ cuối tuần, qua năm và khoảng dưới bảy ngày", () => {
  for (let day = 0; day < 7; day += 1) {
    const begin = new Date(Date.parse("2026-11-16T23:30:00+07:00") + day * 86400000);
    for (const duration of [1, 45 * 60000, 10 * 86400000]) {
      const deadline = new Date(+begin + duration);
      assert.equal(calculator.supplementDeadline(begin, deadline).getTime(), +deadline);
    }
  }
  for (const [start, end] of [
    ["2026-11-21T23:30:00+07:00", "2026-11-22T00:15:00+07:00"],
    ["2026-11-22T08:00:00+07:00", "2026-11-22T08:01:00+07:00"],
    ["2026-12-31T23:59:00+07:00", "2027-01-10T09:30:00+07:00"],
  ]) {
    const begin = new Date(start!); const deadline = new Date(end!);
    assert.equal(calculator.supplementDeadline(begin, deadline).toISOString(), deadline.toISOString());
    assert.equal(begin.toISOString(), new Date(start!).toISOString());
  }
});

/** Cửa sổ rỗng, ngược và ngày không tồn tại không thể được dùng để cấp quyền */
test("lịch bổ sung chặn hai mốc không hợp lệ", () => {
  const start = new Date("2026-11-21T08:00:00Z");
  for (const end of [start, new Date(+start - 1), new Date("invalid")]) {
    assert.throws(() => calculator.supplementDeadline(start, end));
  }
  assert.throws(() => calculator.supplementDeadline(new Date("invalid"), start));
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
