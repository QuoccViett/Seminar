import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import webpush from "web-push";
import { NestFactory } from "@nestjs/core";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";

/** Chạy VC06 với Nest/PostgreSQL/Mailpit thật trên DB thử nghiệm riêng
 * Không gửi tới mailbox bên ngoài; Web Push được kiểm ở API/DB và chưa gọi endpoint công khai giả
 */
test("VC06 cấp credential mã hóa, SMTP cục bộ và mời Web Push một lần", async () => {
  const databaseUrl = process.env.VC06_TEST_DATABASE_URL;
  assert.ok(databaseUrl && new URL(databaseUrl).pathname.startsWith("/vc06_test_"), "Cần PostgreSQL thử nghiệm VC06 riêng");
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = "vc06-test-secret-only-at-least-32-characters";
  process.env.WEB_ORIGINS = "http://127.0.0.1:5173";
  process.env.PUBLIC_APP_URL = "http://127.0.0.1:5173";
  process.env.NODE_ENV = "test";
  process.env.TZ = "UTC";
  process.env.EMAIL_ENABLED = "true";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1025";
  process.env.SMTP_AUTH_REQUIRED = "false";
  process.env.SMTP_ALLOW_INSECURE_LOCAL = "true";
  process.env.MAIL_FROM = "vc06@example.invalid";
  process.env.WEB_PUSH_ENABLED = "true";
  process.env.ZALO_ZNS_ENABLED = "false";
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const vapid = webpush.generateVAPIDKeys();
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.WEB_PUSH_SUBJECT = "mailto:vc06@example.invalid";
  const initialPassword = ["123", "456"].join("");
  const changedPassword = ["MatkhauMoiVC06", "-", "9"].join("");
  const buildRoot = "../../dist";
  const { AppModule } = await import(`${buildRoot}/app.module.js`);
  const { PrismaService } = await import(`${buildRoot}/prisma/prisma.service.js`);
  const { CredentialDispatchService } = await import(`${buildRoot}/modules/notifications/credential-dispatch.service.js`);
  const { NotificationsService } = await import(`${buildRoot}/modules/notifications/notifications.service.js`);
  const { AllExceptionsFilter } = await import(`${buildRoot}/common/filters/all-exceptions.filter.js`);
  const { createApiValidationPipe } = await import(`${buildRoot}/common/pipes/api-validation.pipe.js`);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  const prisma = app.get<PrismaServiceType>(PrismaService);
  const worker = app.get(CredentialDispatchService);
  worker.onModuleDestroy();
  app.get(NotificationsService).onModuleDestroy();
  const base = await app.getUrl();
  const suffix = randomUUID().slice(0, 8);
  const adminId = randomUUID();
  const targetEmail = `vc06-${suffix}@example.invalid`;

  /** Gọi route HTTP thật và giữ response trong test, không in token/mật khẩu ra log */
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  try {
    const adminPassword = "MatkhauAdminVC06-9";
    const now = new Date();
    await prisma.user.create({ data: { id: adminId, username: `vc06-admin-${suffix}`, passwordHash: await bcrypt.hash(adminPassword, 8), fullName: "Quản trị kiểm thử VC06", role: "ADMIN", mustChangePassword: false, createdAt: now, updatedAt: now } });
    const login = await request("POST", "auth/login", undefined, { username: `vc06-admin-${suffix}`, password: adminPassword });
    assert.equal(login.status, 200);
    const adminToken = login.body.accessToken as string;
    const created = await request("POST", "users", adminToken, { username: `vc06-target-${suffix}`, fullName: "Người nhận kiểm thử VC06", role: "ADMIN", email: targetEmail });
    assert.equal(created.status, 201);
    const userId = created.body.id as string;
    assert.equal(created.body.temporaryPassword, "123456");
    const dispatch = await prisma.credentialDispatch.findUniqueOrThrow({ where: { userId_credentialVersion: { userId, credentialVersion: 0 } }, include: { deliveries: true } });
    assert.ok(dispatch.ciphertext && !dispatch.ciphertext.includes("123456"));
    assert.equal(dispatch.deliveries.length, 2);
    assert.equal(dispatch.deliveries.find((item) => item.channel === "EMAIL")?.errorCode, "EMAIL_UNCONFIRMED");
    assert.equal(dispatch.deliveries.find((item) => item.channel === "WEB_PUSH")?.errorCode, "NO_SUBSCRIPTION");
    assert.equal((await request("POST", `users/${userId}/credential-deliveries/confirm-email`, adminToken, { email: "wrong@example.invalid" })).status, 400);
    assert.equal((await request("POST", `users/${userId}/credential-deliveries/confirm-email`, adminToken, { email: targetEmail })).status, 200);
    const initialStatus = await request("GET", `users/${userId}/credential-deliveries`, adminToken);
    assert.equal(initialStatus.status, 200);
    assert.equal(initialStatus.body.allRequiredChannelsSent, false);
    assert.equal("ciphertext" in initialStatus.body, false);

    // Hoãn Push giả để chỉ cho phép đúng một email credential qua Mailpit trong lượt kiểm thử
    await prisma.credentialDelivery.updateMany({ where: { dispatchId: dispatch.id, channel: "WEB_PUSH" }, data: { nextAttemptAt: new Date(Date.now() + 600000) } });
    const claim = await worker.claimOne();
    assert.equal(claim?.id, dispatch.deliveries.find((item) => item.channel === "EMAIL")?.id);
    await worker.processClaim(claim!);
    const sent = await prisma.credentialDelivery.findUniqueOrThrow({ where: { id: claim!.id } });
    assert.equal(sent.status, "SENT");
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credentialsSentAt);
    const mail = await fetch(`http://127.0.0.1:8025/view/latest.txt?query=${encodeURIComponent(`to:${targetEmail}`)}`);
    assert.equal(mail.status, 200);
    const body = await mail.text();
    assert.match(body, /Mật khẩu ban đầu: 123456/);
    const invitationToken = body.match(/onboarding\/web-push#token=([A-Za-z0-9_-]{64})/)?.[1];
    assert.ok(invitationToken);

    const publicKey = await request("GET", "notifications/web-push/public-key");
    assert.equal(publicKey.body.publicKey, vapid.publicKey);
    assert.equal((await request("POST", "onboarding/web-push/verify", undefined, { token: invitationToken })).status, 201);
    // Không có thiết bị thì worker giữ PENDING/NO_SUBSCRIPTION và không gọi endpoint Push giả
    await prisma.credentialDelivery.updateMany({ where: { dispatchId: dispatch.id, channel: "WEB_PUSH" }, data: { nextAttemptAt: null } });
    const pushClaim = await worker.claimOne();
    assert.equal(pushClaim?.id, dispatch.deliveries.find((item) => item.channel === "WEB_PUSH")?.id);
    await worker.processClaim(pushClaim!);
    const waitingPush = await prisma.credentialDelivery.findUniqueOrThrow({ where: { id: pushClaim!.id } });
    assert.equal(waitingPush.status, "PENDING");
    assert.equal(waitingPush.errorCode, "NO_SUBSCRIPTION");
    const subscription = { endpoint: `https://fcm.googleapis.com/fcm/send/vc06-${suffix}`, keys: { p256dh: randomBytes(65).toString("base64url"), auth: randomBytes(16).toString("base64url") }, expirationTime: null };
    assert.equal((await request("POST", "onboarding/web-push/subscriptions", undefined, { token: invitationToken, subscription })).status, 201);
    assert.equal((await prisma.webPushSubscription.findUniqueOrThrow({ where: { endpoint: subscription.endpoint } })).userId, userId);
    assert.equal((await prisma.credentialDelivery.findUniqueOrThrow({ where: { id: pushClaim!.id } })).nextAttemptAt, null);
    assert.equal((await request("POST", "onboarding/web-push/subscriptions", undefined, { token: invitationToken, subscription })).status, 401);
    assert.equal((await request("POST", "notifications/web-push/subscriptions", adminToken, subscription)).status, 409);
    assert.equal((await request("POST", "notifications/web-push/subscriptions", adminToken, { ...subscription, endpoint: "http://127.0.0.1/private" })).status, 400);

    // Đổi mật khẩu qua HTTP thật xóa ciphertext và hủy Push đang chờ theo phiên bản cũ
    const userLogin = await request("POST", "auth/login", undefined, { username: `vc06-target-${suffix}`, password: initialPassword });
    assert.equal(userLogin.status, 200);
    const changed = await request("POST", "auth/change-password", userLogin.body.accessToken as string, { currentPassword: initialPassword, newPassword: changedPassword });
    assert.equal(changed.status, 200);
    const after = await prisma.credentialDispatch.findUniqueOrThrow({ where: { id: dispatch.id }, include: { deliveries: true } });
    assert.equal(after.ciphertext, null);
    assert.ok(after.canceledAt);
    assert.equal(after.deliveries.find((item) => item.channel === "WEB_PUSH")?.status, "SKIPPED");
    assert.equal((await request("POST", "onboarding/web-push/verify", undefined, { token: invitationToken })).status, 401);
    // Trạng thái thông báo thường thuộc đúng user, IDOR trả 404 và ZNS tắt không xếp delivery
    const ownNotice = await request("POST", "notifications/test", adminToken, { channel: "SYSTEM" });
    assert.equal(ownNotice.status, 201);
    const deliveryStatus = await request("GET", `notifications/${ownNotice.body.notificationId}/deliveries`, adminToken);
    assert.equal(deliveryStatus.status, 200);
    assert.deepEqual(deliveryStatus.body.channels, []);
    assert.equal((await request("GET", `notifications/${ownNotice.body.notificationId}/deliveries`, changed.body.accessToken as string)).status, 404);
    assert.equal((await request("POST", "notifications/test", adminToken, { channel: "ZALO_ZNS" })).status, 400);
  } finally { await app.close(); }
});
