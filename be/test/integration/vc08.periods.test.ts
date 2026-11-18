import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { NestFactory } from "@nestjs/core";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";

/** Kiểm thử VC08 qua HTTP Nest và PostgreSQL riêng có đủ migration
 * Chỉ chạy khi URL chỉ rõ database vc08_test để tránh thay đổi DB dùng chung
 * Đồng hồ backend được cố định tại các mốc biên, không gửi thông báo qua provider ngoài
 */
test("VC08 công bố cạnh tranh và ẩn tiêu chí theo giờ server qua HTTP thật", async () => {
  const url = process.env.VC08_TEST_DATABASE_URL;
  assert.ok(url && new URL(url).pathname === "/vc08_test", "Cần database vc08_test riêng để kiểm thử");
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = "vc08-test-secret-only-at-least-32-characters";
  process.env.WEB_ORIGINS = "http://127.0.0.1:5173";
  process.env.PUBLIC_APP_URL = "http://127.0.0.1:5173";
  process.env.NODE_ENV = "test";
  process.env.INITIAL_ACCOUNT_PASSWORD = "123456";
  process.env.EMAIL_ENABLED = "false";
  process.env.WEB_PUSH_ENABLED = "false";
  process.env.ZALO_ZNS_ENABLED = "false";
  const dist = new URL("../../dist/", import.meta.url);
  const { AppModule } = await import(new URL("app.module.js", dist).href);
  const { PrismaService } = await import(new URL("prisma/prisma.service.js", dist).href);
  const { ClockService } = await import(new URL("common/services/clock.service.js", dist).href);
  const { AuditService } = await import(new URL("common/services/audit.service.js", dist).href);
  const { AllExceptionsFilter } = await import(new URL("common/filters/all-exceptions.filter.js", dist).href);
  const { createApiValidationPipe } = await import(new URL("common/pipes/api-validation.pipe.js", dist).href);
  const app = await NestFactory.create(AppModule, { logger: false });
  const filter = new AllExceptionsFilter();
  const originalCatch = filter.catch.bind(filter);
  // Chỉ ghi mã lỗi kỹ thuật khi test thất bại, không in message/query/credential nội bộ
  filter.catch = (error: unknown, host: Parameters<typeof originalCatch>[1]) => {
    if (typeof error === "object" && error !== null && "code" in error) console.error("Mã lỗi kỹ thuật kiểm thử:", String(error.code));
    originalCatch(error, host);
  };
  app.useGlobalFilters(filter);
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  const prisma = app.get<PrismaServiceType>(PrismaService);
  const clock = app.get(ClockService);
  const base = await app.getUrl();
  let instant = new Date("2026-11-28T16:29:59.999Z");
  clock.now = () => new Date(instant);

  /** Gửi JSON tới server nội bộ và trả status cùng nội dung phản hồi để kiểm tra quyền
   * token là phiên đăng nhập thật, body tùy chọn và không ghi thông tin xác thực ra log
   */
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const result = await fetch(`${base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: result.status, body: await result.json() as { accessToken: string; id: string; code: string; year: number; criteriaVisible: boolean; selfEvalState: string; supplementDeadline: string; [index: number]: { name: string } } };
  }

  try {
    const now = new Date();
    const unitId = randomUUID();
    const adminId = randomUUID();
    const unitUserId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const password = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.unit.create({ data: { id: unitId, code: `VC08-${suffix}`, name: "Đơn vị kiểm thử", isActive: true, createdAt: now, updatedAt: now } });
    await prisma.user.createMany({ data: [
      { id: adminId, username: `vc08-admin-${suffix}`, passwordHash, fullName: "Quản trị kiểm thử", role: "ADMIN", mustChangePassword: false, createdAt: now, updatedAt: now },
      { id: unitUserId, username: `vc08-unit-${suffix}`, passwordHash, fullName: "Đơn vị kiểm thử", role: "UNIT", unitId, mustChangePassword: false, createdAt: now, updatedAt: now },
    ] });
    const admin = await request("POST", "auth/login", undefined, { username: `vc08-admin-${suffix}`, password });
    const unit = await request("POST", "auth/login", undefined, { username: `vc08-unit-${suffix}`, password });
    assert.equal(admin.status, 200);
    assert.equal(unit.status, 200);
    const adminToken = admin.body.accessToken as string;
    const unitToken = unit.body.accessToken as string;
    const latest = await prisma.evaluationPeriod.aggregate({ _max: { year: true } });
    // Mốc mở là thứ Bảy 23:30 giờ Việt Nam và hạn là Chủ nhật 00:00 để xác nhận lịch tự chấm không lọc ngày nghỉ
    const created = await request("POST", "evaluation-periods", adminToken, { year: Math.max(2026, (latest._max.year ?? 2025) + 1), name: "Kỳ kiểm thử", maxTotalScore: 300, selfEvalStart: "2026-11-28T16:30:00Z", selfEvalDeadline: "2026-11-28T17:00:00Z" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id as string;
    const hiddenDrafts = await request("GET", "evaluation-periods?pageSize=100", unitToken);
    assert.equal(JSON.stringify(hiddenDrafts.body).includes(id), false);
    assert.equal((await request("GET", `evaluation-periods/${id}`, unitToken)).status, 404);
    // Giả lập lỗi audit trong transaction thật để xác nhận tiêu chí không bị lưu dở dang
    const audit = app.get(AuditService);
    const originalRecord = audit.record.bind(audit);
    audit.record = async () => { throw new Error("Lỗi audit kiểm thử"); };
    try {
      assert.equal((await request("POST", `evaluation-periods/${id}/criteria`, adminToken, { code: "ROLLBACK", name: "Không được lưu", maxScore: 300, sortOrder: 1 })).status, 500);
      assert.equal(await prisma.criterion.count({ where: { periodId: id, code: "ROLLBACK" } }), 0);
    } finally {
      audit.record = originalRecord;
    }
    const criterion = await request("POST", `evaluation-periods/${id}/criteria`, adminToken, { code: "1", name: "Nội dung bí mật trước giờ mở", maxScore: 300, sortOrder: 1 });
    assert.equal(criterion.status, 201, JSON.stringify(criterion.body));
    const thresholds = [
      { rating: "EXCELLENT", label: "Xuất sắc", minPercent: 85, minExclusive: true },
      { rating: "GOOD", label: "Tốt", minPercent: 65, minExclusive: false },
      { rating: "PASS", label: "Đạt", minPercent: 50, minExclusive: false },
      { rating: "FAIL", label: "Chưa đạt", minPercent: 0, minExclusive: false },
    ];
    assert.equal((await request("PUT", `evaluation-periods/${id}/thresholds`, adminToken, thresholds)).status, 200);
    // Ba yêu cầu tranh cùng khóa kỳ: chỉ một publish thành công và sửa không được lọt sau publish
    const [first, second, edit] = await Promise.all([
      request("POST", `evaluation-periods/${id}/publish`, adminToken),
      request("POST", `evaluation-periods/${id}/publish`, adminToken),
      request("PATCH", `evaluation-periods/${id}/criteria/${criterion.body.id}`, adminToken, { description: "Cập nhật trước công bố" }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 400]);
    assert.ok([200, 400].includes(edit.status));
    assert.equal(await prisma.evaluation.count({ where: { periodId: id, unitId } }), 1);
    assert.equal(await prisma.criterionScore.count({ where: { evaluation: { periodId: id, unitId } } }), 1);
    const saved = await prisma.criterion.findUniqueOrThrow({ where: { id: criterion.body.id } });
    assert.equal(saved.description, edit.status === 200 ? "Cập nhật trước công bố" : null);
    assert.equal(await prisma.auditLog.count({ where: { entity: "Criterion", entityId: criterion.body.id, action: "UPDATE" } }), edit.status === 200 ? 1 : 0);
    assert.equal((await request("PATCH", `evaluation-periods/${id}/criteria/${criterion.body.id}`, adminToken, { name: "Không được sửa" })).status, 400);
    assert.equal((await request("PATCH", `criteria/${criterion.body.id}`, adminToken, { name: "Không được sửa qua route phẳng" })).status, 400);
    assert.equal((await request("DELETE", `criteria/${criterion.body.id}`, adminToken)).status, 400);
    assert.equal((await request("PATCH", `criteria/${criterion.body.id}`, unitToken, { name: "Không có quyền sửa" })).status, 403);
    const hidden = await request("GET", `evaluation-periods/${id}`, unitToken);
    assert.equal(hidden.status, 200);
    assert.equal(JSON.stringify(hidden.body).includes("Nội dung bí mật"), false);
    assert.equal(hidden.body.criteriaVisible, false);
    assert.deepEqual(await request("GET", `evaluation-periods/${id}/thresholds`, unitToken).then((result) => result.body), []);
    assert.equal((await request("GET", `evaluation-periods/${id}/criteria`, unitToken)).body.code, "NOT_OPEN_YET");
    instant = new Date("2026-11-28T16:30:00.000Z");
    assert.equal((await request("GET", `evaluation-periods/${id}/criteria`, unitToken)).body[0].name, "Nội dung bí mật trước giờ mở");
    instant = new Date("2026-11-28T17:00:00.000Z");
    // Các đường mới vẫn đi qua Auth/DTO thật, không chấp nhận phase tùy ý trong PATCH
    assert.equal((await request("GET", `evaluation-periods/${id}/phase-options`)).status, 401);
    assert.equal((await request("POST", `evaluation-periods/${id}/transition-phase`, unitToken, { phase: "FIRST_REVIEW" })).status, 403);
    assert.equal((await request("PATCH", `evaluation-periods/${id}`, adminToken, { phase: "CLOSED" })).status, 400);
    assert.equal((await request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "SETUP" })).status, 400);
    assert.equal((await request("PUT", `evaluation-periods/${id}/thresholds`, adminToken, thresholds)).status, 400);

    // Mọi ví dụ lịch tạm đều qua HTTP thật, ngày UTC khác Việt Nam vẫn phải chặn đúng cuối tuần
    for (const [start, expected] of [
      ["2026-11-16T07:00:00+07:00", "2026-11-17T17:00:00.000Z"],
      ["2026-11-17T07:00:00+07:00", "2026-11-18T17:00:00.000Z"],
      ["2026-11-18T07:00:00+07:00", "2026-11-19T17:00:00.000Z"],
      ["2026-11-19T07:00:00+07:00", "2026-11-20T17:00:00.000Z"],
      ["2026-11-20T23:30:00+07:00", "2026-11-20T17:00:00.000Z"],
    ]) {
      const preview = await request("POST", "evaluation-periods/supplement-schedule/preview", adminToken, { supplementStartAt: start });
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.supplementDeadline, expected);
    }
    for (const start of ["2026-11-21T00:00:00+07:00", "2026-11-22T23:30:00+07:00", "2026-11-20T07:00:00", "2026-02-30T07:00:00Z"]) {
      assert.equal((await request("POST", "evaluation-periods/supplement-schedule/preview", adminToken, { supplementStartAt: start })).status, 400);
    }
    assert.equal((await request("POST", "evaluation-periods/supplement-schedule/preview", unitToken, { supplementStartAt: "2026-11-20T00:00:00Z" })).status, 403);

    // Bỏ lỡ job mở vẫn khóa được tại deadline, lỗi audit phải rollback phase, hồ sơ và history
    audit.record = async () => { throw new Error("Lỗi audit kiểm thử giai đoạn"); };
    try {
      assert.equal((await request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "FIRST_REVIEW" })).status, 500);
      assert.equal((await prisma.evaluationPeriod.findUniqueOrThrow({ where: { id } })).phase, "SETUP");
      assert.equal(await prisma.evaluation.count({ where: { periodId: id, status: "PENDING_REVIEW" } }), 0);
      assert.equal(await prisma.statusHistory.count({ where: { evaluation: { periodId: id } } }), 0);
    } finally { audit.record = originalRecord; }
    const phaseRace = await Promise.all([
      request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "FIRST_REVIEW" }),
      request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "FIRST_REVIEW" }),
    ]);
    assert.deepEqual(phaseRace.map((item) => item.status).sort(), [200, 400]);
    const totalEvaluations = await prisma.evaluation.count({ where: { periodId: id } });
    assert.equal(await prisma.statusHistory.count({ where: { evaluation: { periodId: id }, toStatus: "PENDING_REVIEW" } }), totalEvaluations);
    assert.equal(await prisma.evaluation.count({ where: { periodId: id, status: "DRAFT" } }), 0);
    assert.equal((await request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "FINAL_REVIEW" })).status, 400);
    // Fixture DB mô phỏng đầu ra thẩm định VC12, không coi đây là API thẩm định đã triển khai
    await prisma.evaluation.updateMany({ where: { periodId: id }, data: { firstReviewedAt: instant } });
    assert.equal((await request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "FINAL_REVIEW" })).status, 200);
    assert.equal((await request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "CLOSED" })).status, 400);
    await prisma.evaluation.updateMany({ where: { periodId: id }, data: { status: "FINALIZED", finalizedAt: instant, finalizedById: adminId, finalScore: 0, finalPercent: 0, finalRating: "FAIL" } });
    const closeRace = await Promise.all([
      request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "CLOSED" }),
      request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "CLOSED" }),
    ]);
    assert.deepEqual(closeRace.map((item) => item.status).sort(), [200, 400]);
    assert.equal(await prisma.auditLog.count({ where: { entityId: id, action: "TRANSITION_PHASE" } }), 3);
    assert.equal((await request("POST", `evaluation-periods/${id}/transition-phase`, adminToken, { phase: "SELF_EVAL" })).status, 400);
    // Kỳ terminal không thể mở lại quyền INITIAL ngay cả khi deadline bị sửa trực tiếp ngoài API
    await prisma.evaluationPeriod.update({ where: { id }, data: { selfEvalDeadline: new Date(instant.getTime() + 86400000) } });
    assert.equal((await request("GET", `evaluation-periods/${id}`, unitToken)).body.selfEvalState, "CLOSED");
    assert.equal((await request("PATCH", `evaluation-periods/${id}`, adminToken, { selfEvalDeadline: "2026-12-01T00:00:00Z", changeReason: "Không được mở lại" })).status, 400);

    // Kỳ thứ hai kiểm công bố thiếu lịch, tổng sai, rồi đi đủ các cạnh có vòng bổ sung
    const draft = await request("POST", "evaluation-periods", adminToken, { year: (created.body.year as number) + 1, name: "Kỳ nhánh bổ sung", maxTotalScore: 300 });
    assert.equal(draft.status, 201);
    const secondId = draft.body.id;
    assert.equal((await request("POST", `evaluation-periods/${secondId}/publish`, adminToken)).body.code, "PUBLISH_CHECK_FAILED");
    for (const deadline of ["2026-11-28T16:30:00Z", "2026-11-28T16:29:00Z"]) {
      assert.equal((await request("PATCH", `evaluation-periods/${secondId}`, adminToken, { selfEvalStart: "2026-11-28T16:30:00Z", selfEvalDeadline: deadline })).status, 400);
    }
    assert.equal((await request("PATCH", `evaluation-periods/${secondId}`, adminToken, { selfEvalStart: "2026-11-28T16:30:00" })).status, 400);
    await request("PATCH", `evaluation-periods/${secondId}`, adminToken, { selfEvalStart: "2026-11-28T16:30:00Z", selfEvalDeadline: "2026-11-28T17:00:00Z" });
    const wrongTotal = await request("POST", `evaluation-periods/${secondId}/criteria`, adminToken, { code: "1", name: "Tiêu chí nhánh hai", maxScore: 200, sortOrder: 1 });
    const removable = await request("POST", `evaluation-periods/${secondId}/criteria`, adminToken, { code: "TEMP", name: "Tiêu chí xóa thử", maxScore: 1, sortOrder: 2 });
    assert.equal((await request("DELETE", `criteria/${removable.body.id}`, adminToken)).status, 200);
    assert.equal((await request("DELETE", `criteria/${removable.body.id}`, adminToken)).status, 404);
    await request("PUT", `evaluation-periods/${secondId}/thresholds`, adminToken, thresholds);
    instant = new Date("2026-11-28T16:29:59.999Z");
    assert.equal((await request("POST", `evaluation-periods/${secondId}/publish`, adminToken)).status, 422);
    await request("PATCH", `criteria/${wrongTotal.body.id}`, adminToken, { maxScore: 300 });
    assert.equal((await request("POST", `evaluation-periods/${secondId}/publish`, adminToken)).status, 200);
    assert.equal((await request("POST", `evaluation-periods/${secondId}/transition-phase`, adminToken, { phase: "SELF_EVAL" })).status, 400);
    instant = new Date("2026-11-28T16:30:00Z");
    assert.equal((await request("POST", `evaluation-periods/${secondId}/transition-phase`, adminToken, { phase: "SELF_EVAL" })).status, 200);
    assert.equal((await request("POST", `evaluation-periods/${secondId}/transition-phase`, adminToken, { phase: "FIRST_REVIEW" })).status, 400);
    instant = new Date("2026-11-28T17:00:00Z");
    assert.equal((await request("POST", `evaluation-periods/${secondId}/transition-phase`, adminToken, { phase: "FIRST_REVIEW" })).status, 200);
    await prisma.evaluation.updateMany({ where: { periodId: secondId }, data: { firstReviewedAt: instant } });
    const secondEvaluation = await prisma.evaluation.findUniqueOrThrow({ where: { periodId_unitId: { periodId: secondId, unitId } } });
    await prisma.evaluation.update({ where: { id: secondEvaluation.id }, data: { status: "SUPPLEMENT_REQUESTED", supplementRequestedAt: instant, supplementStartAt: new Date("2026-12-04T16:30:00Z"), supplementDeadline: new Date("2026-12-04T17:00:00Z") } });
    assert.equal((await request("POST", `evaluation-periods/${secondId}/transition-phase`, adminToken, { phase: "SUPPLEMENT" })).status, 200);
    assert.equal((await request("POST", `evaluation-periods/${secondId}/transition-phase`, adminToken, { phase: "FINAL_REVIEW" })).status, 400);
    instant = new Date("2026-12-04T17:00:00Z");
    assert.equal((await request("POST", `evaluation-periods/${secondId}/transition-phase`, adminToken, { phase: "FINAL_REVIEW" })).status, 200);
    assert.equal((await prisma.evaluation.findUniqueOrThrow({ where: { id: secondEvaluation.id } })).status, "SUPPLEMENT_EXPIRED");
    assert.equal(await prisma.statusHistory.count({ where: { evaluationId: secondEvaluation.id, toStatus: "SUPPLEMENT_EXPIRED" } }), 1);

    // Source chưa có route đọc score/evidence: xác nhận không có đường phụ làm lộ cấu hình
    for (const path of [`criteria/${criterion.body.id}`, `evaluations/${secondEvaluation.id}`, `criterion-scores/${criterion.body.id}`, `evidences/${randomUUID()}`]) {
      assert.equal((await request("GET", path, unitToken)).status, 404);
    }
    instant = new Date("2026-11-28T17:00:00.000Z");
    const closed = await request("GET", `evaluation-periods/${id}`, unitToken);
    assert.equal(closed.body.selfEvalState, "CLOSED");
    assert.equal(closed.body.criteriaVisible, true);
    assert.equal((await request("GET", `evaluation-periods/${id}/criteria`, unitToken)).body[0].name, "Nội dung bí mật trước giờ mở");
  } finally {
    await app.close();
  }
});
