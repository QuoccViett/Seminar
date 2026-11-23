import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { NestFactory } from "@nestjs/core";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";

/** Kiểm thẩm định và chốt qua HTTP cùng PostgreSQL riêng, không dùng provider thật
 * URL bắt buộc mang tên vc12_test để tránh ghi fixture vào cơ sở dữ liệu dùng chung
 * Fixture dùng UUID riêng, không xóa hoặc reset dữ liệu có sẵn trong cơ sở dữ liệu
 */
test("VC12 kiểm quyền, lý do, accept-all, hoàn tất và chốt cạnh tranh", async () => {
  const url = process.env.VC12_TEST_DATABASE_URL;
  assert.ok(url && new URL(url).pathname === "/vc12_test", "Cần cơ sở dữ liệu vc12_test riêng");
  Object.assign(process.env, { DATABASE_URL: url, JWT_SECRET: "vc12-test-secret-only-at-least-32-characters", NODE_ENV: "test", WEB_ORIGINS: "http://127.0.0.1:5179", PUBLIC_APP_URL: "http://127.0.0.1:5179", INITIAL_ACCOUNT_PASSWORD: "123456", EMAIL_ENABLED: "false", WEB_PUSH_ENABLED: "false", ZALO_ZNS_ENABLED: "false" });
  const dist = new URL("../../dist/", import.meta.url);
  const { AppModule } = await import(new URL("app.module.js", dist).href);
  const { PrismaService } = await import(new URL("prisma/prisma.service.js", dist).href);
  const { AllExceptionsFilter } = await import(new URL("common/filters/all-exceptions.filter.js", dist).href);
  const { createApiValidationPipe } = await import(new URL("common/pipes/api-validation.pipe.js", dist).href);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  const prisma = app.get<PrismaServiceType>(PrismaService);
  const base = await app.getUrl();

  /** Gửi HTTP đến Nest thật, giữ token trong bộ nhớ và trả status cùng JSON để kiểm */
  async function request(method: string, path: string, token?: string, body?: object) {
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  try {
    const now = new Date();
    const suffix = randomUUID().slice(0, 8);
    const unitId = randomUUID(); const adminId = randomUUID(); const userId = randomUUID(); const expiredUserId = randomUUID();
    const periodId = randomUUID(); const evaluationId = randomUUID(); const batchEvaluationId = randomUUID(); const batchUnitId = randomUUID(); const expiredId = randomUUID(); const expiredUnitId = randomUUID(); const leaf1 = randomUUID(); const leaf2 = randomUUID();
    const password = `Vc12-${randomUUID()}`; const passwordHash = await bcrypt.hash(password, 4);
    await prisma.unit.create({ data: { id: unitId, code: `VC12-${suffix}`, name: "Đơn vị thử nghiệm", createdAt: now, updatedAt: now } });
    await prisma.unit.create({ data: { id: batchUnitId, code: `VC12-BATCH-${suffix}`, name: "Đơn vị thử nghiệm chốt hàng loạt", createdAt: now, updatedAt: now } });
    await prisma.unit.create({ data: { id: expiredUnitId, code: `VC12-EXPIRED-${suffix}`, name: "Đơn vị thử nghiệm hết hạn", createdAt: now, updatedAt: now } });
    await prisma.user.createMany({ data: [{ id: adminId, username: `vc12-admin-${suffix}`, role: "ADMIN", unitId: null }, { id: userId, username: `vc12-unit-${suffix}`, role: "UNIT", unitId }, { id: expiredUserId, username: `vc12-expired-${suffix}`, role: "UNIT", unitId: expiredUnitId }].map((item) => ({ ...item, fullName: "Người thử nghiệm", passwordHash, mustChangePassword: false, createdAt: now, updatedAt: now })) });
    const maximum = await prisma.evaluationPeriod.aggregate({ _max: { year: true } });
    await prisma.evaluationPeriod.create({ data: { id: periodId, year: Math.max(2050, (maximum._max.year ?? 2049) + 1), name: "Kỳ thử nghiệm", phase: "SELF_EVAL", maxTotalScore: 100, publishedAt: now, selfEvalStart: new Date(+now - 60000), selfEvalDeadline: new Date(+now + 3600000), createdById: adminId, createdAt: now, updatedAt: now } });
    await prisma.criterion.createMany({ data: [{ id: leaf1, code: "A", maxScore: 60 }, { id: leaf2, code: "B", maxScore: 40 }].map((item, index) => ({ ...item, periodId, name: item.code, evidenceRequired: false, sortOrder: index, createdAt: now, updatedAt: now })) });
    await prisma.ratingThreshold.createMany({ data: [{ rating: "EXCELLENT", minPercent: 85, minExclusive: true }, { rating: "GOOD", minPercent: 65, minExclusive: false }, { rating: "PASS", minPercent: 50, minExclusive: false }, { rating: "FAIL", minPercent: 0, minExclusive: false }].map((item) => ({ ...item, id: randomUUID(), periodId, label: item.rating })) });
    // So sánh các ngưỡng trực tiếp bằng hàm DB dùng chung với view và kết quả chốt
    for (const [percent, expected] of [[49.99, "FAIL"], [50, "PASS"], [65, "GOOD"], [85, "GOOD"], [85.01, "EXCELLENT"]] as const) {
      const [rating] = await prisma.$queryRaw<{ rating: string }[]>`SELECT fn_rating_for_percent(${periodId}::uuid, ${percent}::numeric) AS rating`;
      assert.equal(rating.rating, expected);
    }
    await prisma.evaluation.create({ data: { id: evaluationId, periodId, unitId, status: "DRAFT", createdAt: now, updatedAt: now } });
    await prisma.criterionScore.createMany({ data: [{ criterionId: leaf1, selfScore: 50 }, { criterionId: leaf2, selfScore: 35 }].map((item) => ({ ...item, id: randomUUID(), evaluationId, createdAt: now, updatedAt: now })) });
    await prisma.evaluation.create({ data: { id: batchEvaluationId, periodId, unitId: batchUnitId, status: "DRAFT", createdAt: now, updatedAt: now } });
    await prisma.criterionScore.createMany({ data: [{ criterionId: leaf1, selfScore: 50 }, { criterionId: leaf2, selfScore: 35 }].map((item) => ({ ...item, id: randomUUID(), evaluationId: batchEvaluationId, createdAt: now, updatedAt: now })) });
    await prisma.evaluation.update({ where: { id: batchEvaluationId }, data: { status: "PENDING_REVIEW", submittedAt: now, firstReviewedAt: now } });
    await prisma.evaluation.create({ data: { id: expiredId, periodId, unitId: expiredUnitId, status: "DRAFT", createdAt: now, updatedAt: now } });
    await prisma.criterionScore.createMany({ data: [{ criterionId: leaf1, selfScore: 50 }, { criterionId: leaf2, selfScore: 35 }].map((item) => ({ ...item, id: randomUUID(), evaluationId: expiredId, createdAt: now, updatedAt: now })) });
    await prisma.evaluation.update({ where: { id: expiredId }, data: { status: "PENDING_REVIEW", submittedAt: now, firstReviewedAt: now } });
    await prisma.criterionScore.update({ where: { evaluationId_criterionId: { evaluationId: expiredId, criterionId: leaf1 } }, data: { needsSupplement: true, supplementNote: "Bổ sung báo cáo" } });
    await prisma.evaluation.update({ where: { id: expiredId }, data: { status: "SUPPLEMENT_REQUESTED", supplementRequestedAt: new Date(+now - 180000), supplementStartAt: new Date(+now - 120000), supplementDeadline: new Date(+now - 60000) } });
    await prisma.evaluation.update({ where: { id: evaluationId }, data: { status: "PENDING_REVIEW", submittedAt: now } });
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { phase: "FIRST_REVIEW" } });
    const adminToken = (await request("POST", "auth/login", undefined, { username: `vc12-admin-${suffix}`, password })).body.accessToken as string;
    const unitToken = (await request("POST", "auth/login", undefined, { username: `vc12-unit-${suffix}`, password })).body.accessToken as string;
    const expiredToken = (await request("POST", "auth/login", undefined, { username: `vc12-expired-${suffix}`, password })).body.accessToken as string;
    assert.ok(adminToken && unitToken && expiredToken);
    // Job chưa chạy nhưng nộp quá hạn phải báo mã ổn định và commit trạng thái hết hạn
    assert.equal((await prisma.evaluation.findUniqueOrThrow({ where: { id: expiredId } })).status, "SUPPLEMENT_REQUESTED");
    const expired = await request("POST", `evaluations/${expiredId}/supplement-submit`, expiredToken, {});
    assert.equal(expired.body.code, "DEADLINE_PASSED");
    assert.equal((await prisma.evaluation.findUniqueOrThrow({ where: { id: expiredId } })).status, "SUPPLEMENT_EXPIRED");
    const path = `admin/evaluations/${evaluationId}`;
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/review`, unitToken, { adminScore: 40, adminComment: "Thiếu minh chứng" })).status, 403);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/review`, adminToken, { adminScore: 40 })).status, 422);
    const batchReview = await request("PUT", `${path}/scores/review-batch`, adminToken, { items: [{ criterionId: leaf1, adminScore: 40, adminComment: "Thiếu minh chứng" }, { criterionId: leaf2, adminScore: 41, adminComment: "Vượt điểm" }] });
    assert.equal(batchReview.status, 200);
    assert.deepEqual((batchReview.body.results as { ok: boolean }[]).map((item) => item.ok), [true, false]);
    const accepted = await request("POST", `${path}/accept-all`, adminToken, {});
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.acceptedCount, 1);
    assert.equal((await prisma.criterionScore.findUniqueOrThrow({ where: { evaluationId_criterionId: { evaluationId, criterionId: leaf1 } } })).adminScore?.toNumber(), 40);
    assert.equal((await request("POST", `${path}/first-review-complete`, adminToken, {})).status, 200);

    // Chọn cuối tuần tương lai với cửa sổ 90 phút do Admin quyết định
    let start = new Date(Date.now() + 86400000);
    while (new Date(+start + 7 * 3600000).getUTCDay() !== 6) start = new Date(+start + 86400000);
    const requestBody = { supplementStartAt: start.toISOString(), supplementDeadline: new Date(+start + 90 * 60000).toISOString(), items: [{ criterionId: leaf1, note: "Bổ sung báo cáo" }] };
    assert.equal((await request("POST", `${path}/supplement-request`, adminToken, { ...requestBody, supplementDeadline: start.toISOString() })).status, 400);
    const supplement = await request("POST", `${path}/supplement-request`, adminToken, requestBody);
    assert.equal(supplement.status, 200, JSON.stringify(supplement.body));
    assert.equal(supplement.body.supplementDeadline, requestBody.supplementDeadline);
    assert.equal((await request("POST", `${path}/supplement-request`, adminToken, { ...requestBody, supplementDeadline: new Date(+start + 91 * 60000).toISOString() })).status, 409);
    const retried = await request("POST", `${path}/supplement-request`, adminToken, requestBody);
    assert.equal(retried.body.supplementDeadline, supplement.body.supplementDeadline);
    assert.equal((await request("POST", `${path}/supplement-request`, adminToken, { ...requestBody, supplementStartAt: new Date(+start + 604800000).toISOString() })).status, 409);
    assert.equal(await prisma.evaluationFeedback.count({ where: { evaluationId, type: "SUPPLEMENT_REQUEST" } }), 1);
    assert.equal((await request("POST", `evaluations/${evaluationId}/supplement-submit`, unitToken, {})).status, 403);
    await prisma.evaluation.update({ where: { id: evaluationId }, data: { supplementStartAt: new Date(Date.now() - 60000), supplementDeadline: new Date(Date.now() + 3600000) } });
    assert.equal((await request("POST", `evaluations/${evaluationId}/supplement-submit`, unitToken, {})).status, 422);
    assert.equal((await request("PUT", `evaluations/${evaluationId}/scores/${leaf2}/self`, unitToken, { selfNote: "Sai mục" })).status, 403);
    assert.equal((await request("PUT", `evaluations/${evaluationId}/scores/${leaf1}/self`, unitToken, { selfNote: "Báo cáo đã được bổ sung" })).status, 200);
    assert.equal((await prisma.criterionScore.findUniqueOrThrow({ where: { evaluationId_criterionId: { evaluationId, criterionId: leaf1 } } })).adminScore, null);
    assert.equal((await request("POST", `evaluations/${evaluationId}/supplement-submit`, unitToken, {})).status, 200);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/review`, adminToken, { adminScore: 40, adminComment: "Thiếu minh chứng" })).status, 200);
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { phase: "FINAL_REVIEW" } });
    const preview = await request("POST", "admin/evaluations/finalize-preview", adminToken, { evaluationIds: [evaluationId] });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(((preview.body.results as { data: { score: number; canFinalize: boolean } }[])[0]).data.score, 75);
    assert.equal(((preview.body.results as { data: { score: number; canFinalize: boolean } }[])[0]).data.canFinalize, true);
    const race = await Promise.all([request("POST", `${path}/finalize`, adminToken, {}), request("POST", `${path}/finalize`, adminToken, {})]);
    assert.deepEqual(race.map((row) => row.status).sort(), [200, 403]);
    const final = await prisma.evaluation.findUniqueOrThrow({ where: { id: evaluationId } });
    assert.equal(final.finalScore?.toNumber(), 75);
    assert.equal(final.finalPercent?.toNumber(), 75);
    assert.equal(final.finalRating, "GOOD");
    assert.equal(await prisma.statusHistory.count({ where: { evaluationId, toStatus: "FINALIZED" } }), 1);
    const retryBatch = await request("POST", "admin/evaluations/finalize-batch", adminToken, { evaluationIds: [evaluationId, batchEvaluationId, randomUUID()] });
    assert.deepEqual((retryBatch.body.results as { ok: boolean }[]).map((item) => item.ok), [false, true, false]);
    assert.equal((await prisma.evaluation.findUniqueOrThrow({ where: { id: batchEvaluationId } })).status, "FINALIZED");
  } finally {
    await app.close();
  }
});
