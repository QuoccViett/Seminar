import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createApiValidationPipe } from "../../common/pipes/api-validation.pipe.js";
import { AUTHORIZED_ROLES } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { EvaluationsController } from "./evaluations.controller.js";
import { BatchSelfScoreDto, SelfScoreDto, SubmitEvaluationDto } from "./dto/evaluation.dto.js";

/** Dùng pipe sản phẩm để kiểm kiểu và whitelist thật, không chỉ gọi class-validator đơn lẻ
 * Chỉ UUID/field ổn định được truyền vào lỗi, không đưa target/value có nội dung người dùng ra API
 */
async function validate(type: new () => object, body: unknown) {
  return createApiValidationPipe().transform(body, { type: "body", metatype: type });
}

/** Kiểm DTO đơn chấp nhận xóa null/điểm 0, từ chối số âm/chuỗi/độ chính xác và trường Admin */
test("DTO điểm kiểm hai chữ số thập phân và chống mass assignment", async () => {
  for (const body of [{ selfScore: 0 }, { selfScore: null }, { selfScore: 1.25, selfNote: "Diễn giải" }]) await validate(SelfScoreDto, body);
  for (const body of [{ selfScore: -1 }, { selfScore: 1.001 }, { selfScore: "1" }, { selfScore: true }, { selfNote: "a".repeat(5001) }, { adminScore: 10 }, { needsSupplement: true }, { reviewedById: randomUUID() }]) await assert.rejects(validate(SelfScoreDto, body));
  await assert.rejects(validate(SubmitEvaluationDto, { submittedAt: new Date().toISOString() }));
});

/** Kiểm mảng nested không cho lặp lá hoặc thêm field hệ thống ở bên trong
 * Batch sai cấu trúc phải dừng trước khi bất kỳ ô nào được ghi, dữ liệu nghiệp vụ kiểm riêng qua HTTP
 */
test("DTO batch validate từng phần tử và giới hạn mảng", async () => {
  const criterionId = randomUUID();
  await validate(BatchSelfScoreDto, { items: [{ criterionId, selfScore: 0 }] });
  for (const body of [{ items: [] }, { items: [{ criterionId, adminScore: 2 }] }, { items: [{ criterionId, selfScore: 1.111 }] }, { items: [{ criterionId }, { criterionId }] }, { items: [null] }, { items: [{ criterionId: "sai mã" }] }]) await assert.rejects(validate(BatchSelfScoreDto, body));
});

/** Đối chiếu metadata guard/role và chuyển nguyên identity vào service thay vì lấy từ body
 * Chứng minh các đường tự chấm/nộp chỉ UNIT, còn quyền sở hữu được integration DB kiểm tiếp
 */
test("controller gắn guard và chuyển identity thật cho use-case", async () => {
  assert.deepEqual(Reflect.getMetadata("__guards__", EvaluationsController), [JwtAuthGuard, RolesGuard]);
  for (const method of ["save", "batch", "submit"] as const) assert.deepEqual(Reflect.getMetadata(AUTHORIZED_ROLES, EvaluationsController.prototype[method]), ["UNIT"]);
  const user = { id: randomUUID(), unitId: randomUUID(), role: "UNIT" as const };
  let args: unknown[] = [];
  const controller = new EvaluationsController({ save: async (...values: unknown[]) => { args = values; return "đã chuyển"; } } as never);
  assert.equal(await controller.save("hồ sơ", "tiêu chí", { selfScore: 0 }, user), "đã chuyển");
  assert.deepEqual(args, ["hồ sơ", "tiêu chí", { selfScore: 0 }, user]);
});
