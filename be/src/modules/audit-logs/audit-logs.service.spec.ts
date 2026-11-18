import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AuditLogsService } from "./audit-logs.service.js";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto.js";
import { createApiValidationPipe } from "../../common/pipes/api-validation.pipe.js";

/** Kiểm khoảng thời gian ngược bị chặn trước DB, không biến lỗi đầu vào thành danh sách rỗng */
test("audit từ chối khoảng thời gian ngược trước truy vấn", async () => {
  const service = new AuditLogsService({} as never, {} as never);
  await assert.rejects(service.findAll(Object.assign(new QueryAuditLogDto(), { from: "2026-11-19T00:00:00Z", to: "2026-11-18T00:00:00Z" })), /Thời gian bắt đầu/);
});

/** Kiểm DTO audit không nhận limit/sort cũ hoặc ngày thiếu múi giờ gây lệch báo cáo */
test("DTO audit kiểm định danh hệ thống, phân trang và múi giờ", async () => {
  const pipe = createApiValidationPipe(); const metadata = { type: "query" as const, metatype: QueryAuditLogDto };
  await pipe.transform({ actorId: "SYSTEM", from: "2026-11-18T00:00:00+07:00", pageSize: "10" }, metadata);
  for (const query of [{ actorId: "không hợp lệ" }, { from: "2026-11-18T00:00:00" }, { limit: 20 }, { pageSize: 0 }, { sort: "action" }]) await assert.rejects(pipe.transform(query, metadata));
});
