import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import bcrypt from "bcrypt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../dist/prisma/prisma.service.js";
import { AuditService } from "../dist/common/services/audit.service.js";
import { ClockService } from "../dist/common/services/clock.service.js";
import { EvaluationStateService } from "../dist/modules/evaluations/evaluation-state.service.js";
import { NotificationsService } from "../dist/modules/notifications/notifications.service.js";
import { CredentialDispatchService } from "../dist/modules/notifications/credential-dispatch.service.js";
import { SchedulerService } from "../dist/modules/scheduler/scheduler.service.js";

const url = new URL(process.env.LOAD_TEST_DATABASE_URL ?? "http://missing");
assert.ok(process.env.NODE_ENV === "test" && ["localhost", "127.0.0.1"].includes(url.hostname) && ["postgres:", "postgresql:"].includes(url.protocol) && /^\/seminar_load_test(?:_[a-z0-9_]+)?$/.test(url.pathname), "Chỉ chạy trên DB local seminar_load_test[_hậu_tố] riêng");
const fixturePath = resolve(process.env.LOAD_TEST_FIXTURE_PATH ?? fileURLToPath(new URL("../.tmp/load-test/users.json", import.meta.url)));
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const mode = process.argv[2];
assert.ok(["phase", "credentials"].includes(mode), "Dùng load-test-jobs.mjs phase hoặc credentials");
assert.equal(fixture.mode, mode, `Cần fixture mới LOAD_TEST_MODE=${mode}`);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 5);
const latency = Number(process.env.LOAD_TEST_PROVIDER_MS ?? 50);
assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 10 && latency >= 0 && latency <= 1000);
const config = new ConfigService({ DATABASE_URL: url.href, BACKGROUND_JOBS_ENABLED: false, EMAIL_ENABLED: mode === "credentials", WEB_PUSH_ENABLED: mode === "credentials",
  CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("base64"), PUBLIC_APP_URL: "http://localhost:5173", CREDENTIAL_WORKER_CONCURRENCY: concurrency,
  NOTIFICATION_WORKER_CONCURRENCY: concurrency, WORKER_BUDGET_MS: 4000 });
const db = new PrismaService(config);
const audit = new AuditService(db, new ClockService());
const notifications = new NotificationsService(db, config, [], audit);
let deliveries = 0;
let active = 0;
let peak = 0;
// Provider giả chỉ chờ trong bộ nhớ. Không gọi mạng hoặc dùng secret email/Push hiện có.
const provider = { resolveRecipient: async () => true, send: async () => { active += 1; peak = Math.max(peak, active); await delay(latency); active -= 1; deliveries += 1; return { kind: "sent", providerMessageId: `test-${deliveries}` }; } };
try {
  await db.$connect();
  assert.equal(await db.evaluation.count({ where: { periodId: fixture.periodId } }), fixture.units.length, "Fixture không khớp DB");
  const started = performance.now();
  let processingMs;
  if (mode === "phase") {
    const now = new Date();
    assert.equal(await db.evaluation.count({ where: { periodId: fixture.periodId, status: "DRAFT" } }), fixture.units.length, "Cần fixture chưa chạy chuyển giai đoạn");
    await db.evaluationPeriod.update({ where: { id: fixture.periodId }, data: { selfEvalStart: new Date(+now - 120000), selfEvalDeadline: new Date(+now - 1000) } });
    const scheduler = new SchedulerService(db, audit, new EvaluationStateService(audit, notifications), notifications, config);
    const processingStarted = performance.now();
    await scheduler.processPeriod(fixture.periodId);
    processingMs = performance.now() - processingStarted;
    const phase = await db.evaluationPeriod.findUniqueOrThrow({ where: { id: fixture.periodId } });
    assert.equal(phase.phase, "FIRST_REVIEW");
    assert.equal(await db.evaluation.count({ where: { periodId: fixture.periodId, status: "PENDING_REVIEW" } }), fixture.units.length);
  } else {
    const worker = new CredentialDispatchService(db, config, provider, provider, audit);
    const password = `LoadOnly-${randomBytes(12).toString("hex")}`;
    const passwordHash = await bcrypt.hash(password, 12);
    assert.equal(await db.credentialDispatch.count(), 0, "Cần fixture credential chưa chạy");
    for (let offset = 0; offset < fixture.units.length; offset += 50) {
      await db.$transaction(async (tx) => {
        for (const user of fixture.units.slice(offset, offset + 50)) {
          const email = `load-${user.index}@example.invalid`;
          await tx.user.update({ where: { id: user.userId }, data: { email, passwordHash, mustChangePassword: true } });
          await worker.enqueue(tx, { userId: user.userId, version: 0, username: `load-unit-${user.index}`, password, email });
        }
      }, { timeout: 30000 });
    }
    await db.credentialDispatch.updateMany({ data: { emailConfirmedAt: new Date() } });
    const queuedAt = performance.now();
    while (await db.credentialDelivery.count({ where: { status: "PENDING" } })) await worker.dispatchPending();
    processingMs = performance.now() - queuedAt;
    assert.equal(await db.credentialDelivery.count({ where: { status: "SENT" } }), fixture.units.length * 2);
  }
  const fanoutStarted = performance.now();
  while (await notifications.flushOutbox(100)) { /* bulk materialize durable jobs */ }
  const summary = { mode, accounts: fixture.units.length, processingMs, fanoutMs: performance.now() - fanoutStarted, totalMs: performance.now() - started, simulatedProviderDeliveries: deliveries, peakConcurrency: peak,
    notifications: await db.notification.count(), pendingDeliveries: await db.notificationDelivery.count({ where: { status: "PENDING" } }) };
  await writeFile(`${fixturePath}.${mode}-result.json`, JSON.stringify(summary, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} finally { await db.onModuleDestroy(); }
