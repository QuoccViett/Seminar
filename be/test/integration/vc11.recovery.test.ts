import { ClockService } from "../../src/common/services/clock.service.js";
import { AuditService } from "../../src/common/services/audit.service.js";
import "reflect-metadata";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { NotificationsService } from "../../src/modules/notifications/notifications.service.js";
import { CredentialDispatchService } from "../../src/modules/notifications/credential-dispatch.service.js";

/** Kiểm khôi phục qua các tiến trình Node thật và PostgreSQL thử nghiệm tách biệt
 * URL chỉ được trỏ tới database có tên cố định, provider chỉ là hàm giả trong bộ nhớ
 * Test không reset dữ liệu và không in mật khẩu, khóa mã hóa hay payload thông báo
 */
test("VC11 nhận lại hai lease và khóa kỳ sau khi tiến trình dừng qua cửa sổ", async () => {
  const url = process.env.VC11_TEST_DATABASE_URL;
  assert.ok(url && /^\/vc11_recovery_test(?:_[a-z0-9]+)?$/.test(new URL(url).pathname), "Cần cơ sở dữ liệu vc11_recovery_test riêng");
  const key = randomBytes(32).toString("base64");
  const config = new ConfigService({ DATABASE_URL: url, CREDENTIALS_ENCRYPTION_KEY: key, EMAIL_ENABLED: true, WEB_PUSH_ENABLED: false, ZALO_ZNS_ENABLED: false });
  const db = new PrismaService(config);
  const fake = { channel: "EMAIL" as const, resolveRecipient: async () => true, send: async () => ({ kind: "sent" as const }) };
  // Dùng audit thật cùng DB để worker độc lập cũng kiểm giao dịch dấu vết hệ thống
  const notifications = new NotificationsService(db, config, [fake], new AuditService(db, new ClockService()));
  const credentials = new CredentialDispatchService(db, config, fake as never, fake as never, {} as never);
  const env = { ...process.env, VC11_TEST_DATABASE_URL: url, VC11_TEST_KEY: key };

  /** Khởi động một worker mới cho mỗi lệnh, chỉ trả mã claim hoặc câu xác nhận an toàn
   * Không truyền thông tin đăng nhập thật, không khởi động timer hoặc gọi nhà cung cấp ngoài
   */
  async function worker(action: string, extra: Record<string, string> = {}) {
    return promisify(execFile)(process.execPath, ["test/integration/vc11.worker-process.mjs"], { cwd: process.cwd(), env: { ...env, ...extra, VC11_ACTION: action }, timeout: 45000 });
  }

  await db.$connect();
  try {
    const now = new Date(); const userId = randomUUID(); const unitId = randomUUID(); const periodId = randomUUID(); const evaluationId = randomUUID();
    const username = `vc11-recovery-${randomUUID()}`;
    await db.unit.create({ data: { id: unitId, code: `VC11-${randomUUID()}`, name: "Đơn vị thử phục hồi", createdAt: now, updatedAt: now } });
    await db.user.create({ data: { id: userId, username, fullName: "Người dùng thử phục hồi", email: `${randomUUID()}@example.invalid`, passwordHash: "fixture", role: "UNIT", unitId, mustChangePassword: true, createdAt: now, updatedAt: now } });
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    await db.$transaction((tx) => credentials.enqueue(tx, { userId, version: 0, username, password: "123456", email: user.email }));
    const dispatch = await db.credentialDispatch.findUniqueOrThrow({ where: { userId_credentialVersion: { userId, credentialVersion: 0 } }, include: { deliveries: true } });
    await db.credentialDispatch.update({ where: { id: dispatch.id }, data: { emailConfirmedAt: now } });
    const notificationId = randomUUID(); const deliveryId = randomUUID();
    await db.notification.create({ data: { id: notificationId, userId, type: "TEST", title: "Thông báo thử", body: "Nội dung thử", createdAt: now, deliveries: { create: { id: deliveryId, channel: "EMAIL", status: "PENDING", createdAt: now, updatedAt: now } } } });

    // Worker đầu nhận cả hai việc rồi thoát, worker mới chưa được lấy khi lease vẫn còn hạn
    const first = JSON.parse((await worker("claim")).stdout) as { notification: { id: string; claim_token: string }; credential: { id: string; claim_token: string } };
    assert.equal(first.notification.id, deliveryId); assert.equal(first.credential.id, dispatch.deliveries[0]!.id);
    const early = JSON.parse((await worker("claim")).stdout) as { notification: unknown; credential: unknown };
    assert.equal(early.notification, null); assert.equal(early.credential, null);

    // Cho lease hết hạn trong DB thử, worker mới phải nhận cùng ID với token khác
    const past = new Date(Date.now() - 60000); const expired = new Date(Date.now() - 1000);
    await db.notificationDelivery.update({ where: { id: first.notification.id }, data: { claimedAt: past, leaseUntil: expired } });
    await db.credentialDelivery.update({ where: { id: first.credential.id }, data: { claimedAt: past, leaseUntil: expired } });
    const second = JSON.parse((await worker("claim")).stdout) as typeof first;
    assert.equal(second.notification.id, first.notification.id); assert.notEqual(second.notification.claim_token, first.notification.claim_token);
    assert.equal(second.credential.id, first.credential.id); assert.notEqual(second.credential.claim_token, first.credential.claim_token);
    assert.equal(await notifications.finishClaim(first.notification, 0, { kind: "sent" }), false);
    await credentials.processClaim(first.credential);
    assert.equal((await db.credentialDelivery.findUniqueOrThrow({ where: { id: first.credential.id } })).claimToken, second.credential.claim_token);
    await worker("finish", { VC11_NOTIFICATION_CLAIM: JSON.stringify(second.notification), VC11_CREDENTIAL_CLAIM: JSON.stringify(second.credential) });
    assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).status, "SENT");
    assert.equal((await db.credentialDelivery.findUniqueOrThrow({ where: { id: first.credential.id } })).status, "SENT");

    // Mô phỏng bản ghi lỗi trong từng hàng đợi, xác nhận bản ghi kế tiếp vẫn được gửi
    const badNotice = randomUUID(); const goodNotice = randomUUID();
    for (const id of [badNotice, goodNotice]) await db.notification.create({ data: { id: randomUUID(), userId, type: "TEST", title: "Thông báo thử", body: "Nội dung thử", createdAt: now, deliveries: { create: { id, channel: "EMAIL", status: "PENDING", createdAt: id === badNotice ? new Date(+now - 1000) : now, updatedAt: now } } } });
    const processNotice = notifications.processClaim.bind(notifications);
    notifications.processClaim = async (claim) => { if (claim.id === badNotice) throw new Error("Lỗi mô phỏng của một delivery"); return processNotice(claim); };
    await notifications.dispatchPending(2);
    assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: badNotice } })).status, "PENDING");
    assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: goodNotice } })).status, "SENT");

    const credentialIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const id = randomUUID(); const login = `vc11-retry-${randomUUID()}`; const email = `${randomUUID()}@example.invalid`;
      await db.user.create({ data: { id, username: login, fullName: "Người dùng thử retry", email, passwordHash: "fixture", role: "ADMIN", mustChangePassword: true, createdAt: now, updatedAt: now } });
      await db.$transaction((tx) => credentials.enqueue(tx, { userId: id, version: 0, username: login, password: "123456", email }));
      const created = await db.credentialDispatch.findUniqueOrThrow({ where: { userId_credentialVersion: { userId: id, credentialVersion: 0 } }, include: { deliveries: true } });
      await db.credentialDispatch.update({ where: { id: created.id }, data: { emailConfirmedAt: now } });
      const delivery = created.deliveries[0]!;
      await db.credentialDelivery.update({ where: { id: delivery.id }, data: { createdAt: new Date(+now + index * 1000) } });
      credentialIds.push(delivery.id);
    }
    const processCredential = credentials.processClaim.bind(credentials);
    credentials.processClaim = async (claim) => { if (claim.id === credentialIds[0]) throw new Error("Lỗi mô phỏng của một credential"); return processCredential(claim); };
    await credentials.dispatchPending(2);
    assert.equal((await db.credentialDelivery.findUniqueOrThrow({ where: { id: credentialIds[0]! } })).status, "PENDING");
    assert.equal((await db.credentialDelivery.findUniqueOrThrow({ where: { id: credentialIds[1]! } })).status, "SENT");

    // Kỳ tương lai được ghi khi scheduler dừng, chờ qua cả start và deadline trước khi khởi động lại
    const adminId = randomUUID(); const scheduleNow = new Date();
    await db.user.create({ data: { id: adminId, username: `vc11-admin-${randomUUID()}`, fullName: "Quản trị thử", passwordHash: "fixture", role: "ADMIN", mustChangePassword: false, createdAt: scheduleNow, updatedAt: scheduleNow } });
    const year = ((await db.evaluationPeriod.aggregate({ _max: { year: true } }))._max.year ?? 2100) + 1;
    await db.evaluationPeriod.create({ data: { id: periodId, year, name: "Kỳ thử khôi phục", phase: "SETUP", createdById: adminId, publishedAt: scheduleNow, selfEvalStart: new Date(+scheduleNow + 1000), selfEvalDeadline: new Date(+scheduleNow + 3000), createdAt: scheduleNow, updatedAt: scheduleNow } });
    await db.evaluation.create({ data: { id: evaluationId, periodId, unitId, status: "DRAFT", createdAt: scheduleNow, updatedAt: scheduleNow } });
    await delay(4000);
    await worker("period", { VC11_PERIOD_ID: periodId });
    await worker("period", { VC11_PERIOD_ID: periodId });
    assert.equal((await db.evaluationPeriod.findUniqueOrThrow({ where: { id: periodId } })).phase, "FIRST_REVIEW");
    assert.equal((await db.evaluation.findUniqueOrThrow({ where: { id: evaluationId } })).status, "PENDING_REVIEW");
    assert.equal(await db.statusHistory.count({ where: { evaluationId, toStatus: "PENDING_REVIEW" } }), 1);
    assert.equal(await db.notification.count({ where: { dedupeKey: `PERIOD_PHASE_CHANGED:${periodId}:SELF_EVAL` } }), 0);
    assert.equal(await db.notification.count({ where: { userId, dedupeKey: `PERIOD_PHASE_CHANGED:${periodId}:FIRST_REVIEW` } }), 1);
  } finally { await db.$disconnect(); }
});
