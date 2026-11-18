import assert from "node:assert/strict";
import { test } from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateEvaluationPeriodDto } from "./create-evaluation-period.dto.js";
import { UpdateEvaluationPeriodDto } from "./update-evaluation-period.dto.js";

/** Chuyển payload sang DTO và trả danh sách lỗi validation mà HTTP pipe cũng dùng
 * Type là một trong hai DTO kỳ; payload là các trường giả lập từ request JSON
 * Kiểm tra offset ngay tại biên API trước khi chuỗi được đổi thành Date
 */
async function validationErrors(type: typeof CreateEvaluationPeriodDto | typeof UpdateEvaluationPeriodDto, payload: Record<string, unknown>) {
  const baseline = type === CreateEvaluationPeriodDto ? { year: 2026, name: "Kỳ kiểm thử", ...payload } : payload;
  return validate(plainToInstance(type, baseline), { whitelist: true, forbidNonWhitelisted: true });
}

/** Bảo đảm API từ chối ngày giờ không có offset để không phụ thuộc múi giờ máy chạy BE
 * Chạy cùng trường qua cả create và patch DTO vì hai luồng có validator độc lập
 * Chuỗi có Z hoặc độ lệch UTC cụ thể vẫn được chấp nhận
 */
test("kỳ đánh giá chỉ nhận timestamp có múi giờ tường minh", async () => {
  for (const type of [CreateEvaluationPeriodDto, UpdateEvaluationPeriodDto]) {
    assert.equal((await validationErrors(type, { selfEvalStart: "2026-11-25T00:00:00" })).length > 0, true);
    assert.equal((await validationErrors(type, { selfEvalStart: "2026-11-25T00:00:00Z" })).length, 0);
    assert.equal((await validationErrors(type, { selfEvalDeadline: "2026-11-25T00:00:00+07:00" })).length, 0);
  }
});
