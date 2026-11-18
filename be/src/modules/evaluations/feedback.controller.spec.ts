import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiValidationPipe } from "../../common/pipes/api-validation.pipe.js";
import { AUTHORIZED_ROLES } from "../../common/decorators/roles.decorator.js";
import { CreateFeedbackDto, TimelineQueryDto } from "./dto/feedback.dto.js";
import { FeedbackController } from "./feedback.controller.js";

/** Kiểm pipe thật với nội dung trắng/HTML/control và trường hệ thống, không sao chép validator
 * Đầu ra hợp lệ đã trim, định danh tác giả luôn do phiên cung cấp thay vì body
 */
test("DTO phản hồi chặn nội dung không an toàn và mass assignment", async () => {
  const pipe = createApiValidationPipe();
  const metadata = { type: "body" as const, metatype: CreateFeedbackDto };
  assert.equal((await pipe.transform({ type: "GENERAL", content: "  Diễn giải có dấu  " }, metadata) as CreateFeedbackDto).content, "Diễn giải có dấu");
  for (const body of [{ type: "SUPPLEMENT_REQUEST", content: "Sai luồng" }, { type: "GENERAL", content: "   " }, { type: "GENERAL", content: "x".repeat(4001) }, { type: "GENERAL", content: "<img src=x onerror=alert(1)>" }, { type: "GENERAL", content: "x\u0000" }, { type: "UNIT_REPLY", content: "Nội dung", authorId: "giả mạo" }]) await assert.rejects(pipe.transform(body, metadata));
  for (const query of [{ pageSize: 101 }, { page: 0 }, { page: "không phải số" }]) await assert.rejects(pipe.transform(query, { type: "query", metatype: TimelineQueryDto }));
});

/** Kiểm controller chuyển nguyên identity và DTO, quyền sở hữu được integration DB kiểm tiếp */
test("controller trao đổi dùng identity phiên và guard vai trò", async () => {
  assert.deepEqual(Reflect.getMetadata(AUTHORIZED_ROLES, FeedbackController), ["ADMIN", "UNIT"]);
  let saved: unknown[] = [];
  const controller = new FeedbackController({ create: (...args: unknown[]) => { saved = args; return "Đã chuyển"; } } as never);
  const user = { id: "người dùng", role: "UNIT" as const, unitId: "đơn vị" }; const body = { type: "UNIT_REPLY", content: "Đã giải trình" };
  assert.equal(controller.create("hồ sơ", body, user), "Đã chuyển");
  assert.deepEqual(saved, ["hồ sơ", body, user]);
});
