import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { NotificationsService } from "./notifications.service.js";

test("giữ tùy chọn cá nhân nhưng báo kênh server chưa cấu hình và không xếp hàng thử", async () => {
  let queued = false;
  const prisma = { notificationPreference: { findMany: async () => [] }, $transaction: async () => { queued = true; } };
  const service = new NotificationsService(prisma as never, new ConfigService({ EMAIL_ENABLED: false, WEB_PUSH_ENABLED: false }), [], {} as never);
  const settings = await service.getPreferences("user");
  assert.equal(settings.EMAIL, true);
  assert.equal(settings.WEB_PUSH, true);
  assert.equal(settings.emailAvailable, false);
  assert.equal(settings.webPushAvailable, false);
  const missingChannel = (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    assert.match(JSON.stringify(error.getResponse()), /chưa được kích hoạt trên máy chủ/);
    return true;
  };
  await assert.rejects(service.test("user", "EMAIL"), missingChannel);
  await assert.rejects(service.test("user", "WEB_PUSH"), missingChannel);
  assert.equal(queued, false);
});
