import { ClockService } from "../../src/common/services/clock.service.js";
import { AuditService } from "../../src/common/services/audit.service.js";
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";
import type { NotificationProvider } from "../../src/modules/notifications/notification-provider.js";
import type { NotificationsService as NotificationsServiceType } from "../../src/modules/notifications/notifications.service.js";

/** Kiểm VC05 trên một PostgreSQL riêng đã áp migration, không xóa hoặc reset DB dùng chung
 * Bao phủ HTTP thật, transaction rollback, dedupe, hai worker tranh việc, lease và lỗi từng kênh
 */
test("VC05 hộp thư và outbox trên PostgreSQL thật", async () => {
  const databaseUrl = process.env.VC05_TEST_DATABASE_URL;
  assert.ok(databaseUrl && new URL(databaseUrl).pathname.startsWith("/vc05_test_"), "Cần PostgreSQL thử nghiệm VC05 riêng");
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = "vc05-test-secret-only-at-least-32-characters";
  process.env.WEB_ORIGINS = "http://127.0.0.1:5173";
  process.env.NODE_ENV = "test";
  process.env.TZ = "UTC";
  const buildRoot = "../../dist";
  const { AppModule } = await import(`${buildRoot}/app.module.js`);
  const { PrismaService } = await import(`${buildRoot}/prisma/prisma.service.js`);
  const { NotificationsService } = await import(`${buildRoot}/modules/notifications/notifications.service.js`);
  const { AllExceptionsFilter } = await import(`${buildRoot}/common/filters/all-exceptions.filter.js`);
  const { createApiValidationPipe } = await import(`${buildRoot}/common/pipes/api-validation.pipe.js`);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  const prisma = app.get<PrismaServiceType>(PrismaService);
  const liveService = app.get<NotificationsServiceType>(NotificationsService);
  liveService.onModuleDestroy();
  const base = await app.getUrl();
  const now = new Date();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const testPassword = ["MatkhauVC05", "kiemthu", "9"].join("");

  /** Gọi HTTP thật với token tùy chọn, trả cả status và body để so contract lỗi hoặc thành công */
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Phản hồi HTTP thay đổi theo từng route được kiểm tra
    return { status: response.status, body: await response.json() as Record<string, any> };
  }

  try {
    const hash = await bcrypt.hash(testPassword, 8);
    for (const [id, name] of [[firstId, `vc05-a-${suffix}`], [secondId, `vc05-b-${suffix}`]]) {
      await prisma.user.create({ data: { id, username: name, passwordHash: hash, fullName: "Tài khoản kiểm thử thông báo", role: "ADMIN", mustChangePassword: false, createdAt: now, updatedAt: now } });
    }
    const loginA = await request("POST", "auth/login", undefined, { username: `vc05-a-${suffix}`, password: testPassword });
    const loginB = await request("POST", "auth/login", undefined, { username: `vc05-b-${suffix}`, password: testPassword });
    assert.equal(loginA.status, 200);
    assert.equal(loginB.status, 200);
    const tokenA = loginA.body.accessToken as string;
    const tokenB = loginB.body.accessToken as string;

    // Tạo thông báo trong transaction bị hủy để chứng minh không còn hộp thư hoặc delivery mồ côi
    const rollbackKey = `VC05-ROLLBACK-${suffix}`;
    await assert.rejects(prisma.$transaction(async (tx) => {
      await liveService.notifyUser(tx, { userId: firstId, type: "TEST", title: "Thử hoàn tác", body: "Nội dung kiểm thử hoàn tác", dedupeKey: rollbackKey });
      throw new Error("Chủ động hoàn tác giao dịch kiểm thử");
    }));
    assert.equal(await prisma.notification.count({ where: { userId: firstId, dedupeKey: rollbackKey } }), 0);

    // Cùng khóa sự kiện chỉ có một thông báo và tối đa ba delivery dù nghiệp vụ gọi lặp
    const key = `VC05-DEDUPE-${suffix}`;
    const first = await prisma.$transaction((tx) => liveService.notifyUser(tx, { userId: firstId, type: "TEST", title: "Thông báo thứ nhất", body: "Nội dung thứ nhất", dedupeKey: key, channels: ["WEB_PUSH", "EMAIL"] }));
    const repeated = await prisma.$transaction((tx) => liveService.notifyUser(tx, { userId: firstId, type: "TEST", title: "Thông báo thứ hai", body: "Nội dung thứ hai", dedupeKey: key, channels: ["WEB_PUSH", "EMAIL"] }));
    assert.equal(first.id, repeated.id);
    assert.equal(await prisma.notificationDelivery.count({ where: { notificationId: first.id } }), 2);

    // Hộp thư và preference chỉ của mình; ID của tài khoản khác nhận cùng mã 404 như ID lạ
    assert.equal((await request("GET", "notifications?isRead=false", tokenA)).body.total, 1);
    assert.equal((await request("GET", "notifications/unread-count", tokenA)).body.count, 1);
    assert.equal((await request("PATCH", `notifications/${first.id}/read`, tokenB)).status, 404);
    assert.equal((await request("PATCH", `notifications/${first.id}/read`, tokenA)).body.isRead, true);
    assert.equal((await request("POST", "notifications/read-all", tokenA)).body.updated, 0);
    assert.equal((await request("PATCH", "notifications/preferences", tokenA, { EMAIL: false })).body.EMAIL, false);
    assert.equal((await request("GET", "notifications/preferences", tokenB)).body.EMAIL, true);
    assert.equal((await request("PATCH", "notifications/preferences", tokenA, { SYSTEM: false })).status, 400);
    assert.equal((await request("PATCH", "notifications/preferences", tokenA, { ZALO_ZNS: true })).status, 400);
    assert.equal((await request("POST", "notifications/test", tokenA, { channel: "SYSTEM" })).status, 201);

    // Hai transaction cạnh tranh cùng dedupeKey chỉ giữ một bản ghi nhờ ON CONFLICT của PostgreSQL
    const concurrentKey = `VC05-CONCURRENT-${suffix}`;
    const concurrent = await Promise.all([1, 2].map(() => prisma.$transaction((tx) => liveService.notifyUser(tx, { userId: secondId, type: "TEST", title: "Thử cạnh tranh", body: "Nội dung cạnh tranh", dedupeKey: concurrentKey, channels: [] }))));
    assert.equal(concurrent[0].id, concurrent[1].id);
    assert.equal(await prisma.notification.count({ where: { userId: secondId, dedupeKey: concurrentKey } }), 1);

    // Hai lượt claim đồng thời phải lấy ID khác nhau nhờ FOR UPDATE SKIP LOCKED
    const [claimA, claimB] = await Promise.all([liveService.claimOne(), liveService.claimOne()]);
    assert.ok(claimA && claimB);
    assert.notEqual(claimA.id, claimB.id);

    // Lease hết hạn cho worker mới nhận lại; token cũ không thể ghi đè kết quả gửi mới
    await prisma.notificationDelivery.update({ where: { id: claimA.id }, data: { claimedAt: new Date(Date.now() - 60000), leaseUntil: new Date(Date.now() - 1000) } });
    const reclaimed = await liveService.claimOne();
    assert.equal(reclaimed?.id, claimA.id);
    assert.equal(await liveService.finishClaim(claimA, 0, { kind: "sent" }), false);
    assert.equal(await liveService.finishClaim(reclaimed!, 0, { kind: "sent" }), true);

    // Provider giả có một kênh lỗi vĩnh viễn; kênh còn lại vẫn được xử lý độc lập
    const fake: NotificationProvider[] = [
      { channel: "WEB_PUSH", resolveRecipient: async () => true, send: async () => ({ kind: "skip", reasonCode: "RECIPIENT_MISSING", message: "Chưa có thiết bị nhận thông báo." }) },
      { channel: "EMAIL", resolveRecipient: async () => true, send: async () => ({ kind: "skip", reasonCode: "RECIPIENT_MISSING", message: "Chưa có email nhận thông báo." }) },
    ];
    // Dùng audit thật cùng DB để worker độc lập cũng kiểm giao dịch dấu vết hệ thống
    const providerConfig = new ConfigService({ EMAIL_ENABLED: true, WEB_PUSH_ENABLED: true });
    const worker = new NotificationsService(prisma, providerConfig, fake, new AuditService(prisma, new ClockService()));
    await worker.processClaim(claimB);
    const statuses = await prisma.notificationDelivery.findMany({ where: { notificationId: first.id }, select: { channel: true, status: true, lastError: true } });
    assert.ok(statuses.some((item) => item.status === "SENT"));
    assert.ok(statuses.some((item) => item.status === "SKIPPED"));
    assert.ok(statuses.every((item) => !item.lastError || /[À-ỹ]/u.test(item.lastError)));

    // Provider giả thành công đi qua resolveRecipient và send thật của worker, không chỉ cập nhật DB trực tiếp
    const sent = await prisma.$transaction((tx) => liveService.notifyUser(tx, { userId: secondId, type: "TEST", title: "Thử gửi", body: "Nội dung gửi", channels: ["WEB_PUSH"] }));
    let calls = 0;
    const successful = new NotificationsService(prisma, providerConfig, [{ channel: "WEB_PUSH", resolveRecipient: async () => true, send: async () => { calls += 1; return { kind: "sent", providerMessageId: "push-test" }; } }], new AuditService(prisma, new ClockService()));
    const sendClaim = await successful.claimOne();
    assert.equal(sendClaim?.id, sent.deliveries[0].id);
    await successful.processClaim(sendClaim!);
    assert.equal(calls, 1);
    assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: sendClaim!.id } })).status, "SENT");

    // Năm lỗi tạm chuyển FAILED, còn các lần trước giữ PENDING với thời điểm thử lại tăng dần
    const retryNote = await prisma.$transaction((tx) => liveService.notifyUser(tx, { userId: secondId, type: "TEST", title: "Thử lại", body: "Nội dung thử lại", channels: ["EMAIL"] }));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claim = await liveService.claimOne();
      assert.equal(claim?.id, retryNote.deliveries[0].id);
      assert.equal(await liveService.finishClaim(claim!, attempt - 1, { kind: "retry", reasonCode: "TEMPORARY_FAILURE", message: "Lỗi provider thô có thể chứa bí mật" }), true);
      const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: claim!.id } });
      assert.equal(row.status, attempt === 5 ? "FAILED" : "PENDING");
      assert.equal(row.lastError?.includes("provider thô"), false);
      if (attempt < 5) {
        assert.ok(row.nextAttemptAt && row.nextAttemptAt > new Date());
        await prisma.notificationDelivery.update({ where: { id: claim!.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      }
    }
  } finally {
    await app.close();
  }
});
