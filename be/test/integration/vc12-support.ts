import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { NestFactory } from "@nestjs/core";
import type { PrismaService } from "../../src/prisma/prisma.service.js";
import type { AuditService } from "../../src/common/services/audit.service.js";
import type { EvaluationStateService } from "../../src/modules/evaluations/evaluation-state.service.js";
import type { NotificationsService } from "../../src/modules/notifications/notifications.service.js";
import type { SchedulerService } from "../../src/modules/scheduler/scheduler.service.js";
import type { StorageProvider } from "../../src/modules/evidences/storage.provider.js";

/** Shape phản hồi công khai tối thiểu để assertion đọc dữ liệu có chủ đích
 * Không giữ request header, password hoặc đối tượng lỗi provider trong kết quả kiểm
 */
export interface Vc12Payload {
  id: string; accessToken: string; status: string; code: string; message: string; evaluationId: string;
  adminScore: number | null; adminComment: string | null; reviewedById: string | null; reviewedAt: string | null;
  selfScore: number | null; selfNote: string | null; canEditSelf: boolean; canSubmitSupplement: boolean;
  firstReviewedAt: string; supplementStartAt: string; supplementDeadline: string; supplementRequestedAt: string; finalRatingLabel: string;
  supplementChanged: boolean; supplementBaseline: { content: { selfScore: string | null; selfNote: string | null; evidenceIds: string[] }; review: { adminScore: string | null } } | null;
  permissions: { canReview: boolean; canRequestSupplement: boolean; canCompleteFirstReview: boolean; canFinalize: boolean };
  items: Vc12Payload[]; criteria: Vc12Payload[]; children: Vc12Payload[]; results: Vc12Payload[];
  ok: boolean; data: Vc12Payload; error: Vc12Payload; acceptedCount: number; phase: string;
  score: number; percent: number; rating: string; canFinalize: boolean; serverTime: string;
  uploadUrl: string; uploadId: string; evidences: Vc12Payload[];
}

/** Khởi động Nest/PostgreSQL thật chỉ trên database local mang tên dành riêng VC12
 * Provider ngoài tắt, timer được dừng để test chủ động tạo cạnh tranh và chứng minh job trễ
 * Fixture thêm UUID mới, không reset hoặc xóa dữ liệu cũ và không thay đồng hồ hệ thống
 * VC13–VC15 tái sử dụng điều kiện trước VC12 qua cấu hình tên DB allowlist, không ghi vào DB dùng chung
 */
export async function createVc12Harness(database = { url: process.env.VC12_TEST_DATABASE_URL, name: "vc12_test" }) {
  const url = database.url;
  assert.ok(["vc12_test", "vc13_test", "vc14_test", "vc15_test"].includes(database.name) && url && new URL(url).pathname === `/${database.name}` && ["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Cần database local kiểm thử VC12–VC15 riêng");
  Object.assign(process.env, { DATABASE_URL: url, JWT_SECRET: "vc12-test-secret-only-at-least-32-characters", NODE_ENV: "test", WEB_ORIGINS: "http://127.0.0.1:5182", PUBLIC_APP_URL: "http://127.0.0.1:5182", INITIAL_ACCOUNT_PASSWORD: "123456", EMAIL_ENABLED: "false", WEB_PUSH_ENABLED: "false", ZALO_ZNS_ENABLED: "false", STORAGE_ENABLED: "true", STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: ".tmp/vc12-private-storage" });
  // Mỗi harness có kho báo cáo riêng, không đọc hay dọn kho local của ứng dụng đang dùng
  // Giữ đường dẫn fixture VC13 đã dùng trong assertion hồi quy, các chặng khác theo tên DB riêng
  process.env.REPORT_EXPORT_DIR = database.name === "vc13_test" ? ".tmp/vc13-report-exports" : `.tmp/${database.name}-reports`;
  const dist = new URL("../../dist/", import.meta.url);
  const { AppModule } = await import(new URL("app.module.js", dist).href);
  const { PrismaService: PrismaToken } = await import(new URL("prisma/prisma.service.js", dist).href);
  const { AuditService: AuditToken } = await import(new URL("common/services/audit.service.js", dist).href);
  const { EvaluationStateService: StateToken } = await import(new URL("modules/evaluations/evaluation-state.service.js", dist).href);
  const { NotificationsService: NoticeToken } = await import(new URL("modules/notifications/notifications.service.js", dist).href);
  const { SchedulerService: SchedulerToken } = await import(new URL("modules/scheduler/scheduler.service.js", dist).href);
  const { EvidencesService: EvidenceToken } = await import(new URL("modules/evidences/evidences.service.js", dist).href);
  const { StorageProvider: StorageToken } = await import(new URL("modules/evidences/storage.provider.js", dist).href);
  const { AllExceptionsFilter } = await import(new URL("common/filters/all-exceptions.filter.js", dist).href);
  const { createApiValidationPipe } = await import(new URL("common/pipes/api-validation.pipe.js", dist).href);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter()); app.useGlobalPipes(createApiValidationPipe());
  // Browser VC14/VC15 dùng cổng riêng nếu fixture cũ đang bận, chỉ cho phép origin local đã chỉ định
  const extraOrigin = database.name === "vc14_test" ? process.env.VC14_FE_ORIGIN : database.name === "vc15_test" ? process.env.VC15_FE_ORIGIN : undefined;
  app.enableCors({ origin: extraOrigin ? ["http://127.0.0.1:5182", extraOrigin] : "http://127.0.0.1:5182" });
  await app.listen(Number(process.env.VC12_HTTP_PORT ?? 0), "127.0.0.1");
  const prisma = app.get<PrismaService>(PrismaToken); const audit = app.get<AuditService>(AuditToken);
  const state = app.get<EvaluationStateService>(StateToken); const notifications = app.get<NotificationsService>(NoticeToken);
  const scheduler = app.get<SchedulerService>(SchedulerToken);
  const storage = app.get<StorageProvider>(StorageToken);
  scheduler.onModuleDestroy(); notifications.onModuleDestroy(); app.get(EvidenceToken).onModuleDestroy();
  const base = await app.getUrl();
  const password = "Vc12-Local-Test-Only-2026";
  const passwordHash = await bcrypt.hash(password, 4);
  const suffix = randomUUID().slice(0, 8); const adminId = randomUUID(); const username = `vc12-admin-${suffix}`;
  const now = new Date();
  await prisma.user.create({ data: { id: adminId, username, fullName: "Quản trị viên kiểm thử VC12", passwordHash, mustChangePassword: false, role: "ADMIN", createdAt: now, updatedAt: now } });

  /** Gửi JSON qua HTTP thật, đọc lỗi chuẩn hóa và không log token hoặc thông tin đăng nhập */
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const raw = await response.text();
    return { status: response.status, body: (raw ? JSON.parse(raw) : {}) as Vc12Payload };
  }
  const login = await request("POST", "auth/login", undefined, { username, password });
  assert.equal(login.status, 200); const adminToken = login.body.accessToken;

  /** Tạo một kỳ với các hồ sơ đã nộp để kiểm VC12, các điều kiện trước đó dùng fixture DB thật
   * Từng score được tạo khi DRAFT đang trong cửa sổ rồi mới đổi sang chờ duyệt, giữ trigger hoạt động
   * Mỗi scenario có năm riêng và các tài khoản không có email/phone để không gửi ra người thật
   */
  async function scenario(count = 1, maximum = 100, selfScores = [50, 35]) {
    const timestamp = new Date(); const key = randomUUID().slice(0, 8);
    const periodId = randomUUID(); const parentId = randomUUID(); const leaf1 = randomUUID(); const leaf2 = randomUUID();
    const year = await prisma.evaluationPeriod.aggregate({ _max: { year: true } });
    await prisma.evaluationPeriod.create({ data: { id: periodId, year: Math.max(2050, (year._max.year ?? 2049) + 1), name: `Kỳ VC12 ${key}`, phase: "SELF_EVAL", maxTotalScore: maximum, publishedAt: timestamp, selfEvalStart: new Date(+timestamp - 60000), selfEvalDeadline: new Date(+timestamp + 3600000), createdById: adminId, createdAt: timestamp, updatedAt: timestamp } });
    await prisma.criterion.create({ data: { id: parentId, periodId, code: "G", name: "Nhóm tiêu chí", maxScore: maximum, sortOrder: 0, createdAt: timestamp, updatedAt: timestamp } });
    await prisma.criterion.createMany({ data: [{ id: leaf1, code: "A", maxScore: maximum === 100 ? 60 : maximum }, { id: leaf2, code: "B", maxScore: maximum === 100 ? 40 : maximum }].map((item, index) => ({ ...item, periodId, parentId, name: `Tiêu chí ${item.code}`, evidenceRequired: false, sortOrder: index, createdAt: timestamp, updatedAt: timestamp })) });
    await prisma.ratingThreshold.createMany({ data: [{ rating: "EXCELLENT", minPercent: 85, minExclusive: true }, { rating: "GOOD", minPercent: 65, minExclusive: false }, { rating: "PASS", minPercent: 50, minExclusive: false }, { rating: "FAIL", minPercent: 0, minExclusive: false }].map((item) => ({ ...item, id: randomUUID(), periodId, label: ({ EXCELLENT: "Xuất sắc", GOOD: "Tốt", PASS: "Đạt", FAIL: "Chưa đạt" } as Record<string, string>)[item.rating] })) });
    const records = [];
    for (let index = 0; index < count; index++) {
      const unitId = randomUUID(); const userId = randomUUID(); const evaluationId = randomUUID(); const unitUsername = `vc12-unit-${key}-${index}`;
      await prisma.unit.create({ data: { id: unitId, code: `VC12-${key}-${index}`, name: `Đơn vị VC12 ${key} ${index}`, createdAt: timestamp, updatedAt: timestamp } });
      await prisma.user.create({ data: { id: userId, username: unitUsername, fullName: "Người dùng đơn vị kiểm thử", unitId, role: "UNIT", passwordHash, mustChangePassword: false, createdAt: timestamp, updatedAt: timestamp } });
      await prisma.evaluation.create({ data: { id: evaluationId, periodId, unitId, status: "DRAFT", createdAt: timestamp, updatedAt: timestamp } });
      await prisma.criterionScore.createMany({ data: [leaf1, leaf2].map((criterionId, position) => ({ id: randomUUID(), evaluationId, criterionId, selfScore: selfScores[position], selfNote: "Nội dung ban đầu", createdAt: timestamp, updatedAt: timestamp })) });
      const initialScore = await prisma.criterionScore.findUniqueOrThrow({ where: { evaluationId_criterionId: { evaluationId, criterionId: leaf1 } } });
      await prisma.evidence.create({ data: { id: randomUUID(), criterionScoreId: initialScore.id, uploaderId: userId, kind: "LINK", round: "INITIAL", externalUrl: "https://example.com/bao-cao-ban-dau", createdAt: timestamp } });
      await prisma.evaluation.update({ where: { id: evaluationId }, data: { status: "PENDING_REVIEW", submittedAt: timestamp } });
      const token = (await request("POST", "auth/login", undefined, { username: unitUsername, password })).body.accessToken;
      records.push({ evaluationId, unitId, userId, token, username: unitUsername });
    }
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { phase: "FIRST_REVIEW", selfEvalDeadline: new Date(+timestamp - 1000) } });
    return { periodId, parentId, leaf1, leaf2, records };
  }

  /** Hoàn tất lượt đầu bằng API thật để scenario bổ sung không giả điểm hoặc mốc duyệt */
  async function firstReview(evaluationId: string) {
    assert.equal((await request("POST", `admin/evaluations/${evaluationId}/accept-all`, adminToken, {})).status, 200);
    assert.equal((await request("POST", `admin/evaluations/${evaluationId}/first-review-complete`, adminToken, {})).status, 200);
  }

  /** Chọn một ngày thường tương lai theo giờ Việt Nam mà không phụ thuộc timezone máy kiểm */
  function futureWeekday(weekday = 1) {
    let value = new Date(Date.now() + 7 * 86400000);
    while (new Date(+value + 7 * 3600000).getUTCDay() !== weekday) value = new Date(+value + 86400000);
    return value.toISOString();
  }

  /** Tạo yêu cầu qua API thật rồi mở cửa sổ fixture riêng để kiểm mà không phải chờ nhiều ngày */
  async function supplement(s: Awaited<ReturnType<typeof scenario>>, position = 0, both = false) {
    const { evaluationId } = s.records[position]; await firstReview(evaluationId);
    const body = { supplementStartAt: futureWeekday(), items: (both ? [s.leaf1, s.leaf2] : [s.leaf1]).map((criterionId) => ({ criterionId, note: "Bổ sung báo cáo và minh chứng" })) };
    const response = await request("POST", `admin/evaluations/${evaluationId}/supplement-request`, adminToken, body);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    await prisma.evaluation.update({ where: { id: evaluationId }, data: { supplementStartAt: new Date(Date.now() - 60000), supplementDeadline: new Date(Date.now() + 3600000) } });
    return body;
  }

  return { app, prisma, audit, state, notifications, scheduler, storage, base, adminId, adminToken, username, password, request, scenario, firstReview, futureWeekday, supplement };
}

export type Vc12Harness = Awaited<ReturnType<typeof createVc12Harness>>;
