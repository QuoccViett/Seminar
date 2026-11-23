import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRatingThresholds } from "./rating-threshold-policy.js";

const thresholds = (values: number[]) => ["FAIL", "PASS", "GOOD", "EXCELLENT"].map((rating, i) => ({ rating, label: rating, minPercent: values[i], minExclusive: rating === "EXCELLENT" }));

test("ngưỡng mặc định và tùy chỉnh hợp lệ, thứ tự mảng không ảnh hưởng", () => {
  assert.doesNotThrow(() => assertRatingThresholds(thresholds([0, 50, 65, 85])));
  assert.doesNotThrow(() => assertRatingThresholds(thresholds([0, 45, 70, 90]).reverse()));
});

test("ngưỡng thiếu, trùng, sai thứ tự, ngoài biên hoặc không thể đạt bị chặn", () => {
  for (const values of [[0, 70, 45, 90], [0, 45, 45, 90], [1, 45, 70, 90], [0, -1, 70, 90], [0, 45, 70, 100], [0, 45, 70, 101], [0, 45, 70, NaN], [0, 45.001, 70, 90]]) assert.throws(() => assertRatingThresholds(thresholds(values)));
  const valid = thresholds([0, 45, 70, 90]);
  assert.throws(() => assertRatingThresholds(valid.slice(1)));
  assert.throws(() => assertRatingThresholds([...valid.slice(1), valid[1]!]));
  assert.throws(() => assertRatingThresholds(valid.map((row) => ({ ...row, minExclusive: false }))));
  assert.throws(() => assertRatingThresholds(valid.map((row) => ({ ...row, label: " " }))));
});
