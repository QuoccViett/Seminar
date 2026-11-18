import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AuditLogsController } from "./audit-logs.controller.js";
import { AUTHORIZED_ROLES } from "../../common/decorators/roles.decorator.js";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto.js";

/** Đảm bảo route chuẩn chỉ ADMIN và không đổi bộ lọc trước chuyển cho service
 * HTTP integration kiểm thêm 401/403 để metadata không là bằng chứng quyền duy nhất
 */
test("controller audit dùng route ADMIN và chuyển bộ lọc nguyên vẹn", () => {
  assert.equal(Reflect.getMetadata("path", AuditLogsController), "api/v1/admin/audit-logs");
  assert.deepEqual(Reflect.getMetadata(AUTHORIZED_ROLES, AuditLogsController), ["ADMIN"]);
  const query = new QueryAuditLogDto(); let actual: unknown;
  const controller = new AuditLogsController({ findAll: (value: unknown) => { actual = value; return "Đã chuyển"; } } as never);
  assert.equal(controller.findAll(query), "Đã chuyển"); assert.equal(actual, query);
});
