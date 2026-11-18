import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { NestFactory } from "@nestjs/core";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";

/** Shape tối thiểu của phản hồi kiểm thử, không dùng any để tránh bỏ qua sai kiểu ở assertion
 * Chỉ trường API công khai được đọc, credential tạm chỉ ở bộ nhớ và không ghi vào log
 */
interface Payload {
  id: string; accessToken: string; code: string; message: string; status: string;
  selfScore: number | null; selfNote: string | null; selfTotal: number; currentTotal?: number;
  criteriaVisible: boolean; canEditSelf: boolean; canSubmit: boolean; submittedAt: string | null;
  autoLockedAt: string | null; total: number; criterionId: string; ok: boolean;
  items: Payload[]; criteria: Payload[]; children: Payload[]; results: Payload[]; data: Payload; error: Payload;
}

/** Kiểm VC09 qua HTTP Nest/PostgreSQL thật, từ chối tuyệt đối URL không phải vc09_test
 * Dùng giờ DB thật cho thao tác điểm/nộp và chỉ chỉnh fixture lịch trong database test riêng
 * Provider ngoài đều tắt, outbox vẫn được kiểm trong DB, không gửi tin tới người thật
 */
test("VC09 hồ sơ tự chấm, quyền, transaction, cạnh tranh và khóa quá hạn qua HTTP thật", async () => {
  const url = process.env.VC09_TEST_DATABASE_URL;
  assert.ok(url && new URL(url).pathname === "/vc09_test", "Cần database vc09_test riêng để kiểm thử");
  Object.assign(process.env, { DATABASE_URL: url, JWT_SECRET: "vc09-test-secret-only-at-least-32-characters", NODE_ENV: "test", WEB_ORIGINS: "http://127.0.0.1:5179", PUBLIC_APP_URL: "http://127.0.0.1:5179", INITIAL_ACCOUNT_PASSWORD: "123456", EMAIL_ENABLED: "false", WEB_PUSH_ENABLED: "false", ZALO_ZNS_ENABLED: "false" });
  const dist = new URL("../../dist/", import.meta.url);
  const { AppModule } = await import(new URL("app.module.js", dist).href);
  const { PrismaService } = await import(new URL("prisma/prisma.service.js", dist).href);
  const { AuditService } = await import(new URL("common/services/audit.service.js", dist).href);
  const { AllExceptionsFilter } = await import(new URL("common/filters/all-exceptions.filter.js", dist).href);
  const { createApiValidationPipe } = await import(new URL("common/pipes/api-validation.pipe.js", dist).href);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter()); app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  const prisma = app.get<PrismaServiceType>(PrismaService);
  const base = await app.getUrl();

  /** Gửi JSON tới ứng dụng thật, trả status/body để assertion không che lỗi HTTP
   * Không log token/mật khẩu và không dùng mock router hoặc mock Prisma trong phép thử này
   */
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as Payload };
  }

  try {
    const now = new Date();
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID(); const userId = randomUUID(); const otherUserId = randomUUID();
    const unitId = randomUUID(); const otherUnitId = randomUUID();
    const password = `Vc09-${randomUUID()}`; const passwordHash = await bcrypt.hash(password, 4);
    await prisma.unit.createMany({ data: [unitId, otherUnitId].map((id, index) => ({ id, code: `VC09-${suffix}-${index}`, name: `Đơn vị kiểm thử ${index}`, createdAt: now, updatedAt: now })) });
    await prisma.user.createMany({ data: [
      { id: adminId, username: `vc09-admin-${suffix}`, role: "ADMIN", unitId: null },
      { id: userId, username: `vc09-unit-${suffix}`, role: "UNIT", unitId },
      { id: otherUserId, username: `vc09-other-${suffix}`, role: "UNIT", unitId: otherUnitId },
    ].map((row) => ({ ...row, fullName: "Người dùng kiểm thử", passwordHash, mustChangePassword: false, createdAt: now, updatedAt: now })) });
    const adminToken = (await request("POST", "auth/login", undefined, { username: `vc09-admin-${suffix}`, password })).body.accessToken;
    const unitToken = (await request("POST", "auth/login", undefined, { username: `vc09-unit-${suffix}`, password })).body.accessToken;
    const otherToken = (await request("POST", "auth/login", undefined, { username: `vc09-other-${suffix}`, password })).body.accessToken;
    assert.ok(adminToken && unitToken && otherToken);
    const maximum = await prisma.evaluationPeriod.aggregate({ _max: { year: true } });
    const created = await request("POST", "evaluation-periods", adminToken, { year: Math.max(2050, (maximum._max.year ?? 2049) + 1), name: `VC09 kiểm thử ${suffix}`, maxTotalScore: 100, selfEvalStart: new Date(+now + 3600000).toISOString(), selfEvalDeadline: new Date(+now + 7200000).toISOString() });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const periodId = created.body.id;
    const parent = (await request("POST", `evaluation-periods/${periodId}/criteria`, adminToken, { code: "A", name: "Nhóm tiêu chí bí mật", maxScore: 100, sortOrder: 1 })).body.id;
    const leaf1 = (await request("POST", `evaluation-periods/${periodId}/criteria`, adminToken, { parentId: parent, code: "A.1", name: "Tiêu chí một bí mật", maxScore: 60, evidenceRequired: true, sortOrder: 1 })).body.id;
    const leaf2 = (await request("POST", `evaluation-periods/${periodId}/criteria`, adminToken, { parentId: parent, code: "A.2", name: "Tiêu chí hai", maxScore: 40, evidenceRequired: false, allowText: false, sortOrder: 2 })).body.id;
    assert.ok(parent && leaf1 && leaf2);
    const thresholds = [ { rating: "EXCELLENT", label: "Xuất sắc", minPercent: 85, minExclusive: true }, { rating: "GOOD", label: "Tốt", minPercent: 65, minExclusive: false }, { rating: "PASS", label: "Đạt", minPercent: 50, minExclusive: false }, { rating: "FAIL", label: "Chưa đạt", minPercent: 0, minExclusive: false } ];
    assert.equal((await request("PUT", `evaluation-periods/${periodId}/thresholds`, adminToken, thresholds)).status, 200);
    assert.equal((await request("POST", `evaluation-periods/${periodId}/publish`, adminToken)).status, 200);
    const evaluation = await prisma.evaluation.findUniqueOrThrow({ where: { periodId_unitId: { periodId, unitId } } });
    const id = evaluation.id;
    const path = `evaluations/${id}`;
    assert.equal(await prisma.criterionScore.count({ where: { evaluationId: id } }), 2);

    // Các đường list/detail/summary/score/nộp cùng áp Auth và IDOR, trước mở không có nội dung tiêu chí
    assert.equal((await request("GET", path)).status, 401);
    assert.equal((await request("GET", path, otherToken)).status, 404);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, otherToken, { selfScore: 10 })).status, 404);
    assert.equal((await request("POST", `${path}/submit`, otherToken, {})).status, 404);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, adminToken, { selfScore: 10 })).status, 403);
    assert.equal((await request("GET", `evaluations?periodId=${periodId}`, unitToken)).body.total, 1);
    const hidden = await request("GET", path, unitToken);
    assert.equal(hidden.body.criteriaVisible, false); assert.deepEqual(hidden.body.criteria, []);
    assert.equal(JSON.stringify(hidden.body).includes("bí mật"), false);
    assert.equal((await request("GET", `${path}/score-summary`, unitToken)).body.code, "NOT_OPEN_YET");
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 10 })).status, 403);
    assert.equal((await request("POST", "evaluations", unitToken, { periodId, unitId: otherUnitId })).status, 403);
    assert.equal((await request("GET", "evaluations?periodId=sai", unitToken)).status, 400);

    // Đơn vị tạo sau publish được tạo bù cạnh tranh đúng một hồ sơ và hai score null
    const lateUnitId = randomUUID();
    await prisma.unit.create({ data: { id: lateUnitId, code: `VC09-LATE-${suffix}`, name: "Đơn vị tạo sau công bố", createdAt: now, updatedAt: now } });
    const createRace = await Promise.all([request("POST", "evaluations", adminToken, { periodId, unitId: lateUnitId }), request("POST", "evaluations", adminToken, { periodId, unitId: lateUnitId })]);
    assert.deepEqual(createRace.map((row) => row.status), [200, 200]);
    assert.equal(createRace[0].body.id, createRace[1].body.id);
    assert.equal(await prisma.auditLog.count({ where: { entity: "Evaluation", entityId: createRace[0].body.id, action: "CREATE" } }), 1);
    assert.equal(await prisma.criterionScore.count({ where: { evaluationId: createRace[0].body.id, selfScore: null } }), 2);

    // Chỉ chỉnh lịch fixture DB riêng sang cửa sổ hiện tại, không thay đồng hồ DB hoặc máy dùng chung
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { selfEvalStart: new Date(+now - 60000) } });
    assert.equal((await request("GET", path, unitToken)).body.criteria[0].children[0].canEditSelf, true);
    for (const body of [{ selfScore: -1 }, { selfScore: 1.111 }, { selfScore: "1" }, { adminScore: 9 }, { selfNote: "a".repeat(5001) }]) assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, body)).status, 400);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, {})).status, 400);
    assert.equal((await request("PUT", `${path}/scores/${parent}/self`, unitToken, { selfScore: 1 })).status, 422);
    assert.equal((await request("PUT", `${path}/scores/${randomUUID()}/self`, unitToken, { selfScore: 1 })).status, 404);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 60.01 })).status, 422);
    assert.equal((await request("PUT", `${path}/scores/${leaf2}/self`, unitToken, { selfNote: "Không cho diễn giải" })).status, 422);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 0, selfNote: "Nội dung có dấu" })).status, 200);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: null })).body.selfNote, "Nội dung có dấu");
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 8.25 })).body.selfScore, 8.25);
    assert.equal((await request("GET", path, unitToken)).body.criteria[0].children[0].selfScore, 8.25);

    // Thất bại audit thật bên trong transaction không được giữ điểm vừa ghi hoặc báo thành công
    const audit = app.get(AuditService); const originalRecord = audit.record.bind(audit);
    audit.record = async () => { throw new Error("Lỗi audit phục vụ kiểm rollback"); };
    try { assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 9 })).status, 500); }
    finally { audit.record = originalRecord; }
    assert.equal((await request("GET", path, unitToken)).body.criteria[0].children[0].selfScore, 8.25);

    // Trigger lỗi có chủ đích chỉ trên DB test chứng minh ô đầu rollback, ô sau vẫn ghi được
    await prisma.$executeRawUnsafe(`CREATE FUNCTION vc09_test_reject_note() RETURNS trigger AS $$ BEGIN IF NEW.self_note = 'VC09_SQL_FAILURE' THEN RAISE EXCEPTION 'Lỗi SQL giả lập kiểm batch' USING ERRCODE = '23514'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER vc09_test_reject_note BEFORE UPDATE ON criterion_scores FOR EACH ROW EXECUTE FUNCTION vc09_test_reject_note()`);
    try {
      const batch = await request("PUT", `${path}/scores/self-batch`, unitToken, { items: [{ criterionId: leaf1, selfScore: 20, selfNote: "VC09_SQL_FAILURE" }, { criterionId: leaf2, selfScore: 30 }] });
      assert.equal(batch.status, 200, JSON.stringify(batch.body));
      assert.deepEqual(batch.body.results.map((row) => row.ok), [false, true]);
      assert.equal(batch.body.results[0].error.code, "DB_RULE_VIOLATION");
      assert.equal(JSON.stringify(batch.body).includes("VC09_SQL_FAILURE"), false);
      assert.equal((await request("GET", `${path}/score-summary`, unitToken)).body.selfTotal, 38.25);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER vc09_test_reject_note ON criterion_scores");
      await prisma.$executeRawUnsafe("DROP FUNCTION vc09_test_reject_note()");
    }
    assert.equal((await request("PUT", `${path}/scores/self-batch`, unitToken, { items: [{ criterionId: leaf1, adminScore: 10 }] })).status, 400);
    assert.equal((await request("PUT", `${path}/scores/self-batch`, otherToken, { items: [{ criterionId: leaf1, selfScore: 10 }] })).status, 404);

    // Điểm Admin được cố ý khác để kiểm projection detail/summary không có kênh rò tổng trước chốt
    await prisma.criterionScore.updateMany({ where: { evaluationId: id, criterionId: leaf1 }, data: { adminScore: 1, adminComment: "Điểm fixture kiểm chống lộ tổng thẩm định" } });
    for (const route of [path, `${path}/score-summary`]) {
      const result = await request("GET", route, unitToken);
      assert.equal(/adminScore|adminComment|reviewedById|currentTotal|currentPercent/.test(JSON.stringify(result.body)), false);
    }
    assert.equal((await request("GET", path, adminToken)).body.criteria[0].children[0].selfScore, 8.25);
    assert.equal((await request("GET", `${path}/score-summary`, unitToken)).body.selfTotal, 38.25);
    await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfNote: "   " });
    assert.equal((await request("POST", `${path}/submit`, unitToken, {})).body.code, "INCOMPLETE_EVALUATION");
    await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfNote: "Minh chứng bằng diễn giải hợp lệ" });
    // Lỗi audit khi nộp phải rollback cả status/history/outbox, không chỉ rollback điểm
    audit.record = async () => { throw new Error("Lỗi audit phục vụ kiểm rollback nộp"); };
    try { assert.equal((await request("POST", `${path}/submit`, unitToken, {})).status, 500); }
    finally { audit.record = originalRecord; }
    assert.equal((await prisma.evaluation.findUniqueOrThrow({ where: { id } })).status, "DRAFT");
    assert.equal(await prisma.statusHistory.count({ where: { evaluationId: id } }), 0);
    assert.equal(await prisma.notification.count({ where: { userId: adminId, dedupeKey: `EVALUATION_PENDING_REVIEW:${id}` } }), 0);
    const race = await Promise.all([request("POST", `${path}/submit`, unitToken, {}), request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 50 })]);
    assert.equal(race[0].status, 200, JSON.stringify(race[0].body));
    assert.ok([200, 403].includes(race[1].status));
    const afterRace = (await request("GET", path, unitToken)).body;
    assert.equal(afterRace.status, "PENDING_REVIEW"); assert.equal(afterRace.canSubmit, false);
    assert.equal(afterRace.criteria[0].children[0].selfScore, race[1].status === 200 ? 50 : 8.25);
    assert.equal((await request("POST", `${path}/submit`, unitToken, {})).status, 200);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 1 })).status, 403);
    assert.equal(await prisma.statusHistory.count({ where: { evaluationId: id, toStatus: "PENDING_REVIEW" } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: id, action: "SUBMIT" } }), 1);
    assert.equal(await prisma.notification.count({ where: { userId: adminId, dedupeKey: `EVALUATION_PENDING_REVIEW:${id}` } }), 1);
    assert.equal(await prisma.notificationDelivery.count({ where: { notification: { userId: adminId, dedupeKey: `EVALUATION_PENDING_REVIEW:${id}` }, channel: "ZALO_ZNS" } }), 0);

    // Request được gửi trước hạn nhưng chờ khóa tới sau hạn phải bị từ chối và reconcile đúng một lần
    const otherEvaluation = await prisma.evaluation.findUniqueOrThrow({ where: { periodId_unitId: { periodId, unitId: otherUnitId } } });
    let queued: Promise<Awaited<ReturnType<typeof request>>>;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM evaluation_periods WHERE id = ${periodId}::uuid FOR UPDATE`;
      await tx.$executeRaw`UPDATE evaluation_periods SET self_eval_deadline = (statement_timestamp() AT TIME ZONE 'UTC') + interval '200 milliseconds' WHERE id = ${periodId}::uuid`;
      queued = request("PUT", `evaluations/${otherEvaluation.id}/scores/${leaf1}/self`, otherToken, { selfScore: 1 });
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    assert.equal((await queued!).status, 403);
    const expired = await Promise.all([request("GET", `evaluations/${otherEvaluation.id}`, otherToken), request("GET", `evaluations/${otherEvaluation.id}`, adminToken)]);
    assert.equal(expired[0].body.status, "PENDING_REVIEW"); assert.equal(expired[0].body.submittedAt, null); assert.ok(expired[0].body.autoLockedAt);
    assert.equal(await prisma.statusHistory.count({ where: { evaluationId: otherEvaluation.id, actorId: null, toStatus: "PENDING_REVIEW" } }), 1);
    assert.equal(await prisma.notification.count({ where: { userId: adminId, dedupeKey: `EVALUATION_PENDING_REVIEW:${otherEvaluation.id}` } }), 1);
    assert.equal((await request("GET", `evaluations?periodId=${periodId}&status=DRAFT`, adminToken)).body.total, 0);
    assert.equal((await request("POST", `evaluations/${otherEvaluation.id}/submit`, otherToken, {})).status, 403);
    assert.equal((await prisma.evaluationPeriod.findUniqueOrThrow({ where: { id: periodId } })).phase, "SETUP");
    const score = await prisma.criterionScore.findUniqueOrThrow({ where: { evaluationId_criterionId: { evaluationId: otherEvaluation.id, criterionId: leaf1 } } });
    await assert.rejects(prisma.criterionScore.update({ where: { id: score.id }, data: { selfScore: 1 } }));
    // DRAFT quá hạn riêng cho trigger submit, không bypass trigger hoặc tắt ràng buộc để làm xanh test
    const extraUnitId = randomUUID();
    await prisma.unit.create({ data: { id: extraUnitId, code: `VC09-DB-${suffix}`, name: "Đơn vị kiểm trigger", createdAt: now, updatedAt: now } });
    const triggerEvaluation = await prisma.evaluation.create({ data: { id: randomUUID(), unitId: extraUnitId, periodId, createdAt: now, updatedAt: now } });
    await assert.rejects(prisma.evaluation.update({ where: { id: triggerEvaluation.id }, data: { status: "PENDING_REVIEW", submittedAt: new Date() } }));

    // Fixture mô phỏng đầu ra yêu cầu bổ sung VC12, chỉ kiểm consumer lưu điểm của VC09
    // Không coi thay đổi DB trực tiếp là bằng chứng API tạo yêu cầu hoặc nộp bổ sung đã triển khai
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { phase: "SUPPLEMENT" } });
    await prisma.evaluation.update({ where: { id }, data: { status: "SUPPLEMENT_REQUESTED", supplementRequestedAt: new Date(), supplementStartAt: new Date(Date.now() + 60000), supplementDeadline: new Date(Date.now() + 120000) } });
    await prisma.criterionScore.updateMany({ where: { evaluationId: id, criterionId: leaf1 }, data: { needsSupplement: true, supplementNote: "Làm rõ minh chứng tiêu chí một", adminScore: 1, adminComment: "Điểm thẩm định fixture" } });
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 15 })).status, 403);
    await prisma.evaluation.update({ where: { id }, data: { supplementStartAt: new Date(Date.now() - 1000) } });
    assert.equal((await request("PUT", `${path}/scores/${leaf2}/self`, unitToken, { selfScore: 10 })).status, 403);
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 15 })).status, 200);
    const supplemented = await prisma.criterionScore.findUniqueOrThrow({ where: { evaluationId_criterionId: { evaluationId: id, criterionId: leaf1 } } });
    assert.ok(supplemented.supplementedAt); assert.equal(supplemented.adminScore, null);
    await prisma.evaluation.update({ where: { id }, data: { supplementDeadline: new Date() } });
    assert.equal((await request("PUT", `${path}/scores/${leaf1}/self`, unitToken, { selfScore: 16 })).status, 403);
    assert.equal((await prisma.criterionScore.findUniqueOrThrow({ where: { id: supplemented.id } })).selfScore?.toNumber(), 15);
    // Snapshot chốt có điểm 0 vẫn được trả đúng, tổng tự chấm tiếp tục độc lập với snapshot cuối
    await prisma.evaluation.update({ where: { id }, data: { status: "FINALIZED", finalizedAt: new Date(), finalizedById: adminId, finalScore: 0, finalPercent: 0, finalRating: "FAIL" } });
    const final = await request("GET", `${path}/score-summary`, unitToken);
    assert.equal(final.body.selfTotal, 45);
    assert.equal(JSON.stringify(final.body).includes('"finalResult":{"score":0,"percent":0,"rating":"FAIL"}'), true);
  } finally { await app.close(); }
});
