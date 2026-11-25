import { ClockService } from "../../src/common/services/clock.service.js";
import { AuditService } from "../../src/common/services/audit.service.js";
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NestFactory } from "@nestjs/core";
import bcrypt from "bcryptjs";
import type { PrismaService as PrismaType } from "../../src/prisma/prisma.service.js";
import type { SchedulerService as SchedulerType } from "../../src/modules/scheduler/scheduler.service.js";

/** Chỉ chạy trên database test riêng, kiểm khóa hàng, outbox và quyền HTTP bằng Nest thật
 * Tất cả provider ngoài tắt, dữ liệu fixture nằm trong container thử nghiệm độc lập
 * Hai lời gọi đồng thời dùng transaction riêng để xác nhận chỉ một lần chuyển và ghi lịch sử
 * URL đầu vào chỉ nhận vc11_test; kết quả chỉ đạt khi trạng thái, outbox, phục hồi và quyền HTTP đều đúng
 * Cấu hình khởi tạo được khai báo tại fixture để chạy trên CI không có tệp môi trường của máy phát triển
 */
test("VC11 chạy bù và cạnh tranh trên PostgreSQL cùng công cụ demo được bảo vệ", async () => {
  const url = process.env.VC11_TEST_DATABASE_URL;
  assert.ok(url && new URL(url).pathname === "/vc11_test", "Cần database vc11_test riêng để kiểm thử");
  // Cấp đầy đủ cấu hình tối thiểu trước khi import AppModule để validation không phụ thuộc tệp môi trường local
  // Hai tên cấu hình CORS dùng cùng origin loopback thử nghiệm, tiến trình restart kế thừa qua env và không truy cập frontend thật
  Object.assign(process.env, { DATABASE_URL: url, NODE_ENV: "test", ENABLE_DEMO_TOOLS: "true", JWT_SECRET: "vc11-test-secret-only-at-least-32-characters", WEB_ORIGINS: "http://127.0.0.1:5182", CORS_ORIGINS: "http://127.0.0.1:5182", EMAIL_ENABLED: "false", WEB_PUSH_ENABLED: "false", ZALO_ZNS_ENABLED: "false" });
  const dist = new URL("../../dist/", import.meta.url);
  const { AppModule } = await import(new URL("app.module.js", dist).href);
  const { PrismaService } = await import(new URL("prisma/prisma.service.js", dist).href);
  const { SchedulerService } = await import(new URL("modules/scheduler/scheduler.service.js", dist).href);
  const { PeriodWorkflowService } = await import(new URL("modules/evaluation-periods/period-workflow.service.js", dist).href);
  const { NotificationsService } = await import(new URL("modules/notifications/notifications.service.js", dist).href);
  // Chuyển lỗi khởi tạo thành rejection để node:test ghi nguyên nhân thay vì Nest thoát cả tiến trình chỉ với mã 1
  // Không bật logger ứng dụng; cấu hình sai vẫn phải làm test thất bại và không thay đổi hành vi khởi động sản phẩm
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(0, "127.0.0.1");
  const db = app.get<PrismaType>(PrismaService);
  const scheduler = app.get<SchedulerType>(SchedulerService);
  try {
    const now = new Date();
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID(); const userId = randomUUID(); const unitId = randomUUID(); const periodId = randomUUID(); const evaluationId = randomUUID();
    const password = `Vc11-${randomUUID()}`;
    const passwordHash = await bcrypt.hash(password, 4);
    await db.unit.create({ data: { id: unitId, code: `VC11-${suffix}`, name: "Đơn vị thử lịch", createdAt: now, updatedAt: now } });
    await db.user.createMany({ data: [
      { id: adminId, username: `vc11-admin-${suffix}`, role: "ADMIN", unitId: null },
      { id: userId, username: `vc11-unit-${suffix}`, role: "UNIT", unitId },
    ].map((row) => ({ ...row, fullName: "Người thử lịch", passwordHash, mustChangePassword: false, createdAt: now, updatedAt: now })) });
    const year = ((await db.evaluationPeriod.aggregate({ _max: { year: true } }))._max.year ?? 2080) + 1;
    await db.evaluationPeriod.create({ data: { id: periodId, year, name: "Kỳ thử lịch", phase: "SETUP", createdById: adminId, publishedAt: now, selfEvalStart: new Date(+now - 172800000), selfEvalDeadline: new Date(+now - 60000), createdAt: now, updatedAt: now } });
    await db.evaluation.create({ data: { id: evaluationId, periodId, unitId, status: "DRAFT", createdAt: now, updatedAt: now } });

    // Bỏ lỡ toàn bộ cửa sổ và quét song song chỉ tạo một history, không tạo tin mở muộn
    await Promise.all([scheduler.processPeriod(periodId), scheduler.processPeriod(periodId)]);
    assert.equal((await db.evaluationPeriod.findUniqueOrThrow({ where: { id: periodId } })).phase, "FIRST_REVIEW");
    const evaluation = await db.evaluation.findUniqueOrThrow({ where: { id: evaluationId } });
    assert.equal(evaluation.status, "PENDING_REVIEW"); assert.ok(evaluation.autoLockedAt);
    assert.equal(await db.statusHistory.count({ where: { evaluationId, toStatus: "PENDING_REVIEW" } }), 1);
    assert.equal(await db.notification.count({ where: { dedupeKey: `PERIOD_PHASE_CHANGED:${periodId}:SELF_EVAL` } }), 0);
    assert.equal(await db.notification.count({ where: { userId, dedupeKey: `PERIOD_PHASE_CHANGED:${periodId}:FIRST_REVIEW` } }), 1);

    // Snapshot bổ sung đã hết hạn không phụ thuộc supplementHours và không tự chốt
    await db.evaluation.update({ where: { id: evaluationId }, data: { status: "SUPPLEMENT_REQUESTED", supplementRequestedAt: new Date(+now - 3600000), supplementStartAt: new Date(+now - 3500000), supplementDeadline: new Date(+now - 1000) } });
    await Promise.all([scheduler.processPeriod(periodId), scheduler.processPeriod(periodId)]);
    assert.equal((await db.evaluation.findUniqueOrThrow({ where: { id: evaluationId } })).status, "SUPPLEMENT_EXPIRED");
    assert.equal(await db.statusHistory.count({ where: { evaluationId, toStatus: "SUPPLEMENT_EXPIRED" } }), 1);

    // Scheduler cạnh tranh chuyển phase cuối phải dùng chung một lần reconcile và outbox bổ sung
    const racePeriod = randomUUID(); const raceEvaluation = randomUUID();
    await db.evaluationPeriod.create({ data: { id: racePeriod, year: year + 2, name: "Kỳ thử cạnh tranh", phase: "FIRST_REVIEW", createdById: adminId, publishedAt: now, selfEvalStart: new Date(+now - 172800000), selfEvalDeadline: new Date(+now - 86400000), createdAt: now, updatedAt: now } });
    await db.evaluation.create({ data: { id: raceEvaluation, periodId: racePeriod, unitId, status: "SUPPLEMENT_REQUESTED", firstReviewedAt: new Date(+now - 7200000), supplementRequestedAt: new Date(+now - 3600000), supplementStartAt: new Date(+now - 3500000), supplementDeadline: new Date(+now - 1000), createdAt: now, updatedAt: now } });
    const workflow = app.get(PeriodWorkflowService) as { transition: (id: string, phase: "FINAL_REVIEW", actorId: string) => Promise<unknown> };
    await Promise.all([scheduler.processPeriod(racePeriod), workflow.transition(racePeriod, "FINAL_REVIEW", adminId)]);
    assert.equal((await db.evaluation.findUniqueOrThrow({ where: { id: raceEvaluation } })).status, "SUPPLEMENT_EXPIRED");
    assert.equal(await db.statusHistory.count({ where: { evaluationId: raceEvaluation, toStatus: "SUPPLEMENT_EXPIRED" } }), 1);
    assert.equal(await db.notification.count({ where: { userId, dedupeKey: `SUPPLEMENT_EXPIRED:${raceEvaluation}` } }), 1);
    // Hồ sơ đã nộp bổ sung vẫn giữ trạng thái sau deadline và không bị scheduler tự chốt
    const submittedUnit = randomUUID(); const submittedId = randomUUID();
    await db.unit.create({ data: { id: submittedUnit, code: `VC11-SUB-${suffix}`, name: "Đơn vị đã bổ sung", createdAt: now, updatedAt: now } });
    await db.evaluation.create({ data: { id: submittedId, periodId: racePeriod, unitId: submittedUnit, status: "SUPPLEMENT_SUBMITTED", firstReviewedAt: new Date(+now - 7200000), supplementRequestedAt: new Date(+now - 3600000), supplementStartAt: new Date(+now - 3500000), supplementDeadline: new Date(+now - 1000), supplementSubmittedAt: new Date(+now - 2000), createdAt: now, updatedAt: now } });
    await scheduler.processPeriod(racePeriod);
    assert.equal((await db.evaluation.findUniqueOrThrow({ where: { id: submittedId } })).status, "SUPPLEMENT_SUBMITTED");
    assert.equal(await db.statusHistory.count({ where: { evaluationId: submittedId, toStatus: "SUPPLEMENT_EXPIRED" } }), 0);

    // Tiến trình khởi động lại sau mốc nhắc vẫn tạo đúng một hộp thư và delivery còn hạn
    const reminderPeriodId = randomUUID(); const reminderEvaluationId = randomUUID();
    const reminderDeadline = new Date(+now + 12 * 60 * 60 * 1000);
    await db.evaluationPeriod.create({ data: { id: reminderPeriodId, year: year + 1, name: "Kỳ thử nhắc", phase: "SELF_EVAL", createdById: adminId, publishedAt: now, selfEvalStart: new Date(+now - 2 * 86400000), selfEvalDeadline: reminderDeadline, createdAt: now, updatedAt: now } });
    await db.evaluation.create({ data: { id: reminderEvaluationId, periodId: reminderPeriodId, unitId, status: "DRAFT", createdAt: now, updatedAt: now } });
    await Promise.all([scheduler.processPeriod(reminderPeriodId), scheduler.processPeriod(reminderPeriodId)]);
    const reminderKey = `REMINDER:${reminderEvaluationId}:INITIAL:${reminderDeadline.toISOString()}`;
    const reminders = await db.notification.findMany({ where: { userId, dedupeKey: reminderKey }, include: { deliveries: true } });
    assert.equal(reminders.length, 1); assert.equal(reminders[0]!.expiresAt?.getTime(), reminderDeadline.getTime());
    assert.deepEqual(reminders[0]!.deliveries.map((item) => item.channel).sort(), ["EMAIL", "WEB_PUSH"]);
    // Một tiến trình Nest mới kế thừa cấu hình fixture và dùng cùng DB để nhận việc còn tồn tại, không nhân đôi nhắc đã ghi
    // Lỗi khởi tạo được trả về qua rejection của execFile thay vì Nest tự thoát mà không cho biết nguyên nhân kiểm thất bại
    const restartScript = 'import { NestFactory } from "@nestjs/core"; import { AppModule } from "./dist/app.module.js"; import { SchedulerService } from "./dist/modules/scheduler/scheduler.service.js"; const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false }); await app.get(SchedulerService).processPeriod(process.env.VC11_PERIOD_ID); await app.close();';
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e", restartScript], { cwd: process.cwd(), env: { ...process.env, VC11_PERIOD_ID: reminderPeriodId }, timeout: 60000 });
    assert.equal(await db.notification.count({ where: { userId, dedupeKey: reminderKey } }), 1);

    // Tin quá hạn bị bỏ qua ngay trước lời gọi mạng dù provider báo có người nhận
    let sends = 0;
    // Dùng audit thật cùng DB để worker độc lập cũng kiểm giao dịch dấu vết hệ thống
    const worker = new NotificationsService(db, { get: (key: string) => key === "EMAIL_ENABLED" } as never, [{ channel: "EMAIL", resolveRecipient: async () => true, send: async () => { sends += 1; return { kind: "sent" as const }; } }], new AuditService(db, new ClockService()));
    const expiredId = randomUUID(); const deliveryId = randomUUID(); const claimToken = randomUUID();
    await db.notification.create({ data: { id: expiredId, userId, type: "SELF_EVAL_REMINDER", title: "Nhắc hạn", body: "Nhắc kiểm thử", expiresAt: new Date(+now - 1000), createdAt: now, deliveries: { create: { id: deliveryId, channel: "EMAIL", status: "PENDING", claimToken, claimedAt: now, leaseUntil: new Date(+now + 30000), createdAt: now, updatedAt: now } } } });
    await worker.processClaim({ id: deliveryId, claim_token: claimToken });
    const expired = await db.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    assert.equal(sends, 0); assert.equal(expired.status, "SKIPPED"); assert.equal(expired.reasonCode, "EXPIRED");

    // Provider giả lỗi tạm rồi thành công kiểm backoff và nhận lại claim đã được cấp mới
    let attempts = 0;
    const retryWorker = new NotificationsService(db, { get: (key: string) => key === "EMAIL_ENABLED" } as never, [{ channel: "EMAIL", resolveRecipient: async () => true, send: async () => { attempts += 1; return attempts === 1 ? { kind: "retry" as const, reasonCode: "TEMPORARY_FAILURE", message: "Lỗi tạm thời" } : { kind: "sent" as const }; } }], new AuditService(db, new ClockService()));
    const retryId = randomUUID(); const retryDeliveryId = randomUUID(); const firstClaim = randomUUID();
    await db.notification.create({ data: { id: retryId, userId, type: "TEST", title: "Kiểm thử", body: "Thử gửi lại", expiresAt: new Date(+now + 3600000), createdAt: now, deliveries: { create: { id: retryDeliveryId, channel: "EMAIL", status: "PENDING", claimToken: firstClaim, claimedAt: now, leaseUntil: new Date(+now + 30000), createdAt: now, updatedAt: now } } } });
    await retryWorker.processClaim({ id: retryDeliveryId, claim_token: firstClaim });
    const retryPending = await db.notificationDelivery.findUniqueOrThrow({ where: { id: retryDeliveryId } });
    assert.equal(retryPending.status, "PENDING"); assert.equal(retryPending.attemptCount, 1); assert.ok(retryPending.nextAttemptAt);
    const secondClaim = randomUUID();
    await db.notificationDelivery.update({ where: { id: retryDeliveryId }, data: { claimToken: secondClaim, claimedAt: now, leaseUntil: new Date(+now + 30000), nextAttemptAt: null } });
    await retryWorker.processClaim({ id: retryDeliveryId, claim_token: secondClaim });
    assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: retryDeliveryId } })).status, "SENT");

    // Dọn token hết hạn nhưng giữ token revoked còn hạn để phát hiện tái sử dụng
    const oldTokenId = randomUUID(); const revokedTokenId = randomUUID();
    await db.refreshToken.createMany({ data: [
      { id: oldTokenId, userId, tokenHash: randomUUID(), expiresAt: new Date(+now - 1000), createdAt: now },
      { id: revokedTokenId, userId, tokenHash: randomUUID(), expiresAt: new Date(+now + 3600000), revokedAt: now, createdAt: now },
    ] });
    await scheduler.run();
    assert.equal(await db.refreshToken.findUnique({ where: { id: oldTokenId } }), null);
    assert.ok(await db.refreshToken.findUnique({ where: { id: revokedTokenId } }));

    /** Đăng nhập vào backend thật để kiểm guard, không xuất mật khẩu hoặc token lên log */
    async function login(username: string): Promise<string> {
      const response = await fetch(`${await app.getUrl()}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      const body = await response.json() as { accessToken: string };
      assert.equal(response.status, 200);
      return body.accessToken;
    }
    const adminToken = await login(`vc11-admin-${suffix}`); const unitToken = await login(`vc11-unit-${suffix}`);
    const endpoint = `${await app.getUrl()}/api/v1/admin/scheduler/run`;
    assert.equal((await fetch(endpoint, { method: "POST" })).status, 401);
    assert.equal((await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${unitToken}` } })).status, 403);
    assert.equal((await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${adminToken}` } })).status, 200);
  } finally { await app.close(); }
});
