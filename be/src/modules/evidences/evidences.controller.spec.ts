import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createApiValidationPipe } from "../../common/pipes/api-validation.pipe.js";
import { AUTHORIZED_ROLES } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { EvidenceBatchDto, UploadBatchDto } from "./dto/evidence.dto.js";
import { EvidencesController } from "./evidences.controller.js";

/** Chạy pipe sản phẩm để kiểm whitelist, nested DTO và câu tiếng Việt trước mọi side effect */
async function validate(type: new () => object, body: unknown) { return createApiValidationPipe().transform(body, { type: "body", metatype: type }); }

/** Metadata hợp lệ qua được DTO, định danh kỹ thuật từ client và mọi phần tử sai phải bị chặn */
test("DTO minh chứng kiểm nested, giới hạn và chống key/round/owner tùy ý", async () => {
  const file = { criterionId: randomUUID(), fileName: "Báo cáo.pdf", mimeType: "application/pdf", sizeBytes: 20 };
  await validate(UploadBatchDto, { items: [file] });
  for (const body of [{ items: [] }, { items: [null] }, { items: Array(11).fill(file) }, { items: [{ ...file, sizeBytes: "20" }] }, { items: [{ ...file, sizeBytes: 10485761 }] }, { items: [{ ...file, round: "INITIAL" }] }, { items: [{ ...file, storagePath: "final/tệp-khác" }] }]) await assert.rejects(validate(UploadBatchDto, body));
  await validate(EvidenceBatchDto, { items: [{ kind: "LINK", criterionId: file.criterionId, externalUrl: "https://example.org" }] });
  for (const item of [{ kind: "FILE", criterionId: file.criterionId }, { kind: "LINK", criterionId: file.criterionId, externalUrl: null }, { kind: "FILE", criterionId: file.criterionId, uploadId: randomUUID(), uploaderId: randomUUID() }, { kind: "FILE", criterionId: file.criterionId, uploadId: randomUUID(), description: null }]) await assert.rejects(validate(EvidenceBatchDto, { items: [item] }));
});

/** Đối chiếu guard bắt đổi mật khẩu và role, controller chuyển nguyên danh tính từ guard sang service */
test("controller minh chứng gắn guard và chỉ UNIT được ghi", async () => {
  assert.deepEqual(Reflect.getMetadata("__guards__", EvidencesController), [JwtAuthGuard, RolesGuard]);
  for (const method of ["uploads", "create", "remove", "cancel"] as const) assert.deepEqual(Reflect.getMetadata(AUTHORIZED_ROLES, EvidencesController.prototype[method]), ["UNIT"]);
  const user = { id: randomUUID(), role: "UNIT" as const, unitId: randomUUID() }; let received: unknown[] = [];
  const controller = new EvidencesController({ uploads: async (...args: unknown[]) => { received = args; return "đã chuyển"; } } as never);
  const dto = { items: [] };
  assert.equal(await controller.uploads("hồ sơ", dto, user), "đã chuyển");
  assert.deepEqual(received, ["hồ sơ", dto, user]);
});
