import dayjs from "dayjs";
import { expect, test } from "vitest";
import { criterionScoreError, fromVietnamDatePicker, scheduleError } from "./configValidation";

test("lịch Việt Nam đổi UTC và chặn quá khứ, bằng hiện tại hoặc kết thúc trước mở", () => {
  const now = Date.parse("2026-11-28T03:00:00Z");
  const start = dayjs("2026-11-28T10:00:00");
  expect(fromVietnamDatePicker(start)).toBe("2026-11-28T03:00:00.000Z");
  expect(scheduleError([start, start.add(2, "hour")], now)).toMatch(/sau thời gian hiện tại/u);
  expect(scheduleError([start.subtract(1, "minute"), start.add(2, "hour")], now)).toMatch(/sau thời gian hiện tại/u);
  expect(scheduleError([start.add(1, "hour"), start.add(1, "hour")], now)).toMatch(/sớm hơn/u);
  expect(scheduleError([start.add(1, "hour"), start.add(2, "hour")], now)).toBeNull();
  expect(scheduleError(null, now)).toBeNull();
  expect(scheduleError([start, null], now)).toMatch(/chọn đủ/u);
});

const tree = [{ id: "p", parentId: null, maxScore: 10, children: [
  { id: "c", parentId: "p", maxScore: 6 }, { id: "s", parentId: "p", maxScore: 4 },
] }, { id: "p2", parentId: null, maxScore: 5 }];

test("form thêm/sửa kiểm điểm cha, tổng anh em, giảm cha và chuyển nhánh", () => {
  expect(criterionScoreError(tree, { parentId: "p", maxScore: 11 })).toMatch(/tiêu chí con không được lớn hơn/u);
  expect(criterionScoreError(tree, { parentId: "p", maxScore: 1 })).toMatch(/Tổng điểm/u);
  expect(criterionScoreError(tree, { id: "c", parentId: "p", maxScore: 7 })).toMatch(/Tổng điểm/u);
  expect(criterionScoreError(tree, { id: "c", parentId: "p", maxScore: 6 })).toBeNull();
  expect(criterionScoreError(tree, { id: "p", maxScore: 9 })).toMatch(/cha không được nhỏ hơn/u);
  expect(criterionScoreError(tree, { id: "c", parentId: "p2", maxScore: 6 })).toMatch(/tiêu chí con không được lớn hơn/u);
  expect(criterionScoreError(tree, { id: "c", parentId: null, maxScore: 20 })).toBeNull();
  expect(criterionScoreError([{ id: "p", maxScore: 0.3, children: [{ id: "a", parentId: "p", maxScore: 0.1 }] }], { parentId: "p", maxScore: 0.2 })).toBeNull();
});
