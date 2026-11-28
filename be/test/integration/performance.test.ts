import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { AuditService } from "../../src/common/services/audit.service.js";
import { ClockService } from "../../src/common/services/clock.service.js";
import { lockPeriod } from "../../src/common/services/period-lock.js";
import { MetricsService } from "../../src/common/services/metrics.service.js";
import { NotificationsService } from "../../src/modules/notifications/notifications.service.js";
import { EvaluationStateService } from "../../src/modules/evaluations/evaluation-state.service.js";
import { SchedulerService } from "../../src/modules/scheduler/scheduler.service.js";
import { CredentialDispatchService } from "../../src/modules/notifications/credential-dispatch.service.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function within<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return Promise.race([promise, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("operation blocked")), { once: true }))]);
}

test("PostgreSQL: khóa chia sẻ, fanout nguyên tử và hủy credential đang gửi", async () => {
  const raw = process.env.PERF_TEST_DATABASE_URL;
  assert.ok(raw, "Cần PERF_TEST_DATABASE_URL cho DB seminar_load_test riêng");
  const url = new URL(raw);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/seminar_load_test");
  const config = new ConfigService({ DATABASE_URL: raw, METRICS_ENABLED: true, EMAIL_ENABLED: false, WEB_PUSH_ENABLED: false });
  const metrics = new MetricsService(config);
  const db = new PrismaService(config, metrics);
  const audit = new AuditService(db, new ClockService());
  const notifications = new NotificationsService(db, config, [], audit);
  const state = new EvaluationStateService(audit, notifications);
  const scheduler = new SchedulerService(db, audit, state, notifications);
  const now = new Date();
  const suffix = randomUUID();
  const adminIds = [randomUUID(), randomUUID()];
  const periodId = randomUUID();
  try {
    await db.$connect();
    assert.equal(await db.user.count(), 0, "Cần DB mới; không chạy trên fixture đã có");
    await db.user.createMany({ data: adminIds.map((id, index) => ({ id, username: `admin-${suffix}-${index}`, fullName: "Admin test", role: "ADMIN", passwordHash: "test-only-no-login", mustChangePassword: false, createdAt: now, updatedAt: now })) });
    await db.evaluationPeriod.create({ data: { id: periodId, year: 2099, name: "Performance integration", phase: "SELF_EVAL", maxTotalScore: 100, publishedAt: now,
      selfEvalStart: new Date(+now - 120000), selfEvalDeadline: new Date(+now + 3600000), createdById: adminIds[0]!, createdAt: now, updatedAt: now } });
    const units = Array.from({ length: 105 }, (_, index) => ({ id: randomUUID(), userId: randomUUID(), evaluationId: randomUUID(), index }));
    await db.unit.createMany({ data: units.map((unit) => ({ id: unit.id, code: `P-${unit.index}`, name: "Unit test", createdAt: now, updatedAt: now })) });
    await db.user.createMany({ data: units.map((unit) => ({ id: unit.userId, unitId: unit.id, username: `unit-${unit.index}`, fullName: "Unit test", role: "UNIT", email: `unit-${unit.index}@example.invalid`, passwordHash: "test-only-no-login", mustChangePassword: true, createdAt: now, updatedAt: now })) });
    await db.evaluation.createMany({ data: units.map((unit) => ({ id: unit.evaluationId, unitId: unit.id, periodId, createdAt: now, updatedAt: now })) });

    // Hai hồ sơ giữ SHARE đồng thời; UPDATE kỳ phải chờ tới khi cả hai nhả khóa.
    const firstLocked = deferred<void>(); const release = deferred<void>();
    const first = db.$transaction(async (tx) => { await lockPeriod(tx, periodId, "shared"); firstLocked.resolve(); await release.promise; }, { timeout: 10000 });
    await firstLocked.promise;
    let exclusiveAcquired = false;
    const exclusive = db.$transaction(async (tx) => { await lockPeriod(tx, periodId); exclusiveAcquired = true; }, { timeout: 10000 });
    try {
      // Lấy SHARE trước khi UPDATE xếp hàng để kiểm khả năng song song, tránh writer fairness của PostgreSQL.
      await delay(30);
      assert.equal(exclusiveAcquired, false);
    } finally { release.resolve(); }
    await Promise.all([first, exclusive]);
    assert.equal(exclusiveAcquired, true);
    const shareGate = deferred<void>(); const shareReady = deferred<void>();
    const shared = db.$transaction(async (tx) => { await lockPeriod(tx, periodId, "shared"); shareReady.resolve(); await shareGate.promise; }, { timeout: 10000 });
    await shareReady.promise;
    try { await within(db.$transaction(async (tx) => { await lockPeriod(tx, periodId, "shared"); })); }
    finally { shareGate.resolve(); await shared; }

    // Fail ngay lúc ghi outbox phải rollback phase/audit; không có khoảng trống sau commit.
    await db.evaluationPeriod.update({ where: { id: periodId }, data: { selfEvalDeadline: new Date(+now - 1000) } });
    const broken = new SchedulerService(db, audit, state, { enqueueMany: async () => { throw new Error("outbox unavailable"); } } as never);
    await assert.rejects(broken.processPeriod(periodId));
    assert.equal((await db.evaluationPeriod.findUniqueOrThrow({ where: { id: periodId } })).phase, "SELF_EVAL");
    assert.equal(await db.auditLog.count(), 0);
    await Promise.all([scheduler.processPeriod(periodId), scheduler.processPeriod(periodId)]);
    assert.equal((await db.evaluationPeriod.findUniqueOrThrow({ where: { id: periodId } })).phase, "FIRST_REVIEW");
    assert.equal(await db.evaluation.count({ where: { periodId, status: "PENDING_REVIEW" } }), 105);
    assert.equal(await db.statusHistory.count(), 105);
    assert.equal(await db.notification.count(), 0);
    const jobs = await db.notificationOutbox.count({ where: { processedAt: null } });
    assert.ok(jobs > 1);
    const brokenMaterializer = new NotificationsService(db, config, [], { recordMany: async () => { throw new Error("audit unavailable"); } } as never);
    await assert.rejects(brokenMaterializer.flushOutbox());
    assert.equal(await db.notification.count(), 0);
    assert.equal(await db.notificationOutbox.count({ where: { processedAt: null } }), jobs);
    await db.notificationPreference.create({ data: { userId: units[0]!.userId, channel: "EMAIL", enabled: false, updatedAt: now } });
    await Promise.all([notifications.flushOutbox(100), notifications.flushOutbox(100)]);
    assert.equal(await db.notification.count(), 107 + 105 * 2);
    assert.equal(await db.notificationDelivery.count({ where: { channel: "EMAIL", notification: { userId: units[0]!.userId } } }), 0);
    await scheduler.processPeriod(periodId);
    await notifications.flushOutbox(100);
    assert.equal(await db.notification.count(), 317);
    assert.equal(await db.statusHistory.count(), 105);

    // Provider dừng giữa I/O; reset vẫn lấy được khóa user và hủy claim ngay.
    const credentialConfig = new ConfigService({ EMAIL_ENABLED: true, WEB_PUSH_ENABLED: false, CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("base64"), PUBLIC_APP_URL: "http://localhost:5173" });
    const sending = deferred<void>(); const finishSend = deferred<void>();
    const provider = { resolveRecipient: async () => true, send: async () => { sending.resolve(); await finishSend.promise; return { kind: "sent" as const }; } };
    const credentials = new CredentialDispatchService(db, credentialConfig, provider as never, provider as never, audit);
    const target = units[0]!;
    await db.$transaction((tx) => credentials.enqueue(tx, { userId: target.userId, version: 0, username: "unit-0", password: "TestOnly-123", email: "unit-0@example.invalid" }));
    await db.credentialDispatch.updateMany({ data: { emailConfirmedAt: now } });
    const claim = await credentials.claimOne(); assert.ok(claim);
    const work = credentials.processClaim(claim);
    await within(sending.promise);
    try {
      await within(db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: target.userId }, data: { credentialVersion: 1, mustChangePassword: false } });
        await credentials.cancelForUser(tx, target.userId);
      }));
    } finally { finishSend.resolve(); await work; }
    const delivery = await db.credentialDelivery.findUniqueOrThrow({ where: { id: claim.id } });
    assert.equal(delivery.status, "SKIPPED"); assert.equal(delivery.errorCode, "CREDENTIAL_CHANGED");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.userId } })).credentialsSentAt, null);
    assert.equal((await db.credentialDispatch.findFirstOrThrow({ where: { userId: target.userId } })).ciphertext, null);
    assert.match(await metrics.registry.metrics(), /seminar_db_query_duration_seconds_count [1-9]/);
  } finally { await db.onModuleDestroy(); metrics.onModuleDestroy(); }
});
