import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { after, before, test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { ModulesContainer } from "@nestjs/core";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { RequestMethod } from "@nestjs/common";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import { createVc12Harness, type Vc12Harness, type Vc12Payload } from "./vc12-support.js";
import type { EmailNotificationProvider } from "../../src/modules/notifications/real-notification-providers.js";
import { serializeApiValue } from "../../src/common/interceptors/api-serialization.interceptor.js";
import type { Prisma } from "../../src/generated/prisma/client.js";
import { NotificationsService } from "../../src/modules/notifications/notifications.service.js";

/** Mô tả các trường công khai được assertion sử dụng thêm cho import, phiên và báo cáo
 * Đây chỉ là kiểu dữ liệu của bộ kiểm, validation và quyền vẫn do DTO/controller/backend thật quyết định
 */
interface Payload extends Vc12Payload {
  refreshToken: string; criteriaVisible: boolean; selfTotal: number; total: number; downloadUrl: string;
  importId: string; createdCount: number; accounts: Array<{ userId: string; username: string }>;
}
let h: Vc12Harness;
const evidence: Record<string, unknown> = {};

/** Dựng backend thật với kho và DB chỉ dành VC17, không tạo tài khoản hoặc gửi tới người thật
 * Khóa mã hóa ngẫu nhiên chỉ tồn tại trong tiến trình để kiểm purge credential và không ghi ra báo cáo
 */
before(async () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  h = await createVc12Harness({ url: process.env.VC17_TEST_DATABASE_URL, name: "vc17_test" });
});

/** Đóng mọi tài nguyên và lưu duy nhất kết quả kiểm, không lưu token, mật khẩu hay URL ký */
after(async () => {
  await h?.app.close();
  await mkdir(".tmp/vc17-artifacts", { recursive: true });
  await writeFile(".tmp/vc17-artifacts/system-results.json", JSON.stringify(evidence, null, 2));
});

/** Gửi JSON qua controller/guard/DTO thật và kiểm giao ước lỗi ở mọi nhánh thất bại
 * Token chỉ gắn vào header, payload thành công được kiểm riêng theo quyền và ngoại lệ cấp credential một lần
 */
async function request(method: string, path: string, token = h.adminToken, body?: unknown) {
  const result = await h.request(method, path, token || undefined, body);
  const payload = result.body as Payload;
  if (result.status >= 400) {
    assert.deepEqual(Object.keys(payload).sort(), ["code", "details", "message", "statusCode"]);
    assert.match(payload.message, /[À-ỹ]/u);
    assert.doesNotMatch(JSON.stringify(payload), /Prisma|SELECT\s|INSERT\s|UPDATE\s|passwordHash|ciphertext|stack|SyntaxError/u);
    for (const detail of (payload as unknown as { details: Array<{ field: string; messages: string[] }> }).details) {
      assert.equal(typeof detail.field, "string");
      assert.ok(detail.messages.every((message) => typeof message === "string" && /[À-ỹ]/u.test(message)));
    }
  }
  return { ...result, body: payload };
}

/** Kiểm đệ quy các trường bí mật và dữ liệu thẩm định chưa được công bố
 * Projection đọc không được có token; phản hồi đổi mật khẩu được cho phép cặp token phiên mới theo contract
 * Không áp cho phản hồi cấp mật khẩu ban đầu một lần đã quy định trong contract
 */
function assertProjection(value: unknown, privateReview = false, allowSession = false) {
  if (Array.isArray(value)) { for (const item of value) assertProjection(item, privateReview, allowSession); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!/^(password|passwordHash|password_hash|temporaryPassword|ciphertext|nonce|authTag|keyId|tokenHash|token_hash|credentialVersion|secret|jwtSecret|smtpPassword|encryptionKey|apiKey|storagePath)$/iu.test(key), `Projection không được có trường ${key}`);
    if (!allowSession) assert.ok(!/^(accessToken|refreshToken)$/u.test(key), `Projection đọc không được có trường phiên ${key}`);
    if (privateReview) assert.ok(!/^(adminScore|adminComment|reviewedById|currentTotal|currentPercent|supplementBaseline)$/u.test(key), `UNIT chưa chốt không được có trường ${key}`);
    assertProjection(child, privateReview, allowSession);
  }
}

/** Chạy trọn nghiệp vụ bằng HTTP thật từ workbook tới kết quả và bytes báo cáo
 * Chỉ rút ngắn lịch trong DB test sau khi API đã tạo snapshot bổ sung để không chờ nhiều ngày
 * Hai hồ sơ đi hai nhánh nộp bổ sung và hết hạn, mọi trạng thái chốt vẫn do service thật quyết định
 */
test("VC17 golden path Import → đổi mật khẩu → công bố → minh chứng → bổ sung/hết hạn → báo cáo", async () => {
  const suffix = randomUUID().slice(0, 8);
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Import UNIT");
  sheet.addRow(["unitCode", "unitName", "unitType", "username", "fullName", "email", "phone"]);
  for (let index = 0; index < 2; index++) sheet.addRow([`VC17-${suffix}-${index}`, `Đơn vị VC17 ${index}`, "DON_VI_TRUC_THUOC", `vc17-${suffix}-${index}`, `Đơn vị VC17 ${index}`, `vc17-${suffix}-${index}@example.invalid`, "0900000001"]);
  const form = new FormData(); form.append("file", new Blob([new Uint8Array(await workbook.xlsx.writeBuffer())]), "don-vi.xlsx");
  const preview = await fetch(`${h.base}/api/v1/users/import/preview`, { method: "POST", headers: { authorization: `Bearer ${h.adminToken}`, "Idempotency-Key": `vc17-${suffix}` }, body: form });
  assert.equal(preview.status, 201); const importId = (await preview.json() as Payload).importId;
  const imported = await request("POST", `users/import/${importId}/confirm`, h.adminToken, {});
  assert.equal(imported.status, 200); assert.equal(imported.body.createdCount, 2);
  const units: Array<{ id: string; token: string; userId: string }> = [];
  // Sinh mật khẩu riêng mỗi lượt từ 18 byte ngẫu nhiên, không dùng credential cố định có thể bị hiểu nhầm là secret
  // Tiền tố bảo đảm có chữ hoa, chữ thường và số; chuỗi ASCII dài 42 byte đáp ứng mức tối thiểu 8 và giới hạn bcrypt 72 byte
  // Chỉ giữ trong bộ nhớ để gửi yêu cầu đổi mật khẩu và đối chiếu hash sau đó, không ghi vào báo cáo hoặc log
  const fixturePassword = `Vc17-${randomBytes(18).toString("hex")}9`;
  for (const account of imported.body.accounts) {
    const login = await request("POST", "auth/login", "", { username: account.username, password: "123456" });
    assert.equal(login.status, 200);
    assert.equal((await request("GET", "evaluations", login.body.accessToken)).status, 403);
    const changed = await request("POST", "auth/change-password", login.body.accessToken, { currentPassword: "123456", newPassword: fixturePassword });
    assert.equal(changed.status, 200); assertProjection(changed.body, false, true);
    const user = await h.prisma.user.findUniqueOrThrow({ where: { id: account.userId } });
    assert.equal(await bcrypt.compare(fixturePassword, user.passwordHash), true);
    assert.equal(user.mustChangePassword, false);
    assert.equal((await h.prisma.credentialDispatch.findFirstOrThrow({ where: { userId: user.id } })).ciphertext, null);
    units.push({ id: user.unitId!, token: changed.body.accessToken, userId: user.id });
  }
  const maximum = await h.prisma.evaluationPeriod.aggregate({ _max: { year: true } });
  const created = await request("POST", "evaluation-periods", h.adminToken, { year: Math.max(2050, (maximum._max.year ?? 2049) + 1), name: `Kỳ golden path ${suffix}`, maxTotalScore: 100, selfEvalStart: new Date(Date.now() + 3600000).toISOString(), selfEvalDeadline: new Date(Date.now() + 7200000).toISOString() });
  assert.equal(created.status, 201); const periodId = created.body.id;
  const criterion = await request("POST", `evaluation-periods/${periodId}/criteria`, h.adminToken, { code: "VC17", name: "Tiêu chí bí mật trước giờ mở VC17", maxScore: 100, evidenceRequired: true, sortOrder: 0 });
  assert.equal(criterion.status, 201); const criterionId = criterion.body.id;
  const thresholds = [{ rating: "EXCELLENT", label: "Xuất sắc", minPercent: 85, minExclusive: true }, { rating: "GOOD", label: "Tốt", minPercent: 65, minExclusive: false }, { rating: "PASS", label: "Đạt", minPercent: 50, minExclusive: false }, { rating: "FAIL", label: "Chưa đạt", minPercent: 0, minExclusive: false }];
  assert.equal((await request("PUT", `evaluation-periods/${periodId}/thresholds`, h.adminToken, thresholds)).status, 200);
  assert.equal((await request("GET", `evaluation-periods/${periodId}`, units[0].token)).status, 404);
  assert.equal((await request("POST", `evaluation-periods/${periodId}/publish`, h.adminToken, {})).status, 200);
  const hidden = await request("GET", `evaluation-periods/${periodId}`, units[0].token);
  assert.equal(hidden.body.criteriaVisible, false); assert.ok(!JSON.stringify(hidden.body).includes("bí mật"));
  assert.equal((await request("GET", `evaluation-periods/${periodId}/criteria`, units[0].token)).status, 400);
  assert.equal((await request("PATCH", `evaluation-periods/${periodId}`, h.adminToken, { selfEvalStart: new Date(Date.now() - 1000).toISOString(), changeReason: "Mở cửa sổ kiểm chứng VC17 bằng API có audit" })).status, 200);
  for (const unit of units) {
    const evaluation = await h.prisma.evaluation.findUniqueOrThrow({ where: { periodId_unitId: { periodId, unitId: unit.id } } });
    const path = `evaluations/${evaluation.id}`;
    assert.equal((await request("GET", path, unit.token)).body.criteriaVisible, true);
    assert.equal((await request("PUT", `${path}/scores/${criterionId}/self`, unit.token, { selfScore: 85.01, selfNote: "Diễn giải ban đầu có dấu" })).status, 200);
    const bytes = Buffer.from("%PDF-1.4\nMinh chứng golden path VC17\n%%EOF");
    const reservation = await request("POST", `${path}/evidences/upload-urls`, unit.token, { items: [{ criterionId, fileName: "Bao-cao.pdf", mimeType: "application/pdf", sizeBytes: bytes.length }] });
    const upload = reservation.body.results[0].data;
    assert.equal((await fetch(`${h.base}${upload.uploadUrl}`, { method: "PUT", headers: { "content-type": "application/pdf" }, body: bytes })).status, 200);
    const file = await request("POST", `${path}/evidences`, unit.token, { items: [{ kind: "FILE", criterionId, uploadId: upload.uploadId }] });
    assert.equal(file.body.results[0].ok, true);
    assert.equal((await request("GET", `${path}/score-summary`, unit.token)).body.selfTotal, 85.01);
    assert.equal((await request("POST", `${path}/submit`, unit.token, {})).status, 200);
  }
  // Chỉ kết thúc lịch fixture sau khi hai hồ sơ đã nộp qua HTTP, không giả trạng thái thẩm định
  await h.prisma.evaluationPeriod.update({ where: { id: periodId }, data: { selfEvalDeadline: new Date(Date.now() - 1) } });
  assert.equal((await request("POST", `evaluation-periods/${periodId}/transition-phase`, h.adminToken, { phase: "FIRST_REVIEW" })).status, 200);
  const records = await h.prisma.evaluation.findMany({ where: { periodId }, orderBy: { unitId: "asc" } });
  for (let index = 0; index < records.length; index++) {
    const record = records[index]; const unit = units.find((item) => item.id === record.unitId)!;
    await h.firstReview(record.id);
    const path = `admin/evaluations/${record.id}`;
    const requested = await request("POST", `${path}/supplement-request`, h.adminToken, { supplementStartAt: h.futureWeekday(5), items: [{ criterionId, note: "Bổ sung báo cáo cho tiêu chí VC17" }] });
    assert.equal(requested.status, 200);
    const snapshot = await h.prisma.evaluation.findUniqueOrThrow({ where: { id: record.id } });
    assert.ok(snapshot.supplementRequestedAt! < snapshot.supplementStartAt!);
    assert.equal((await request("PUT", `evaluations/${record.id}/scores/${criterionId}/self`, unit.token, { selfNote: "Chưa được mở" })).status, 403);
    await h.prisma.evaluation.update({ where: { id: record.id }, data: { supplementStartAt: new Date(Date.now() - 60000), supplementDeadline: new Date(Date.now() + (index === 0 ? 3600000 : -1)) } });
    if (index === 0) {
      assert.equal((await request("PUT", `evaluations/${record.id}/scores/${criterionId}/self`, unit.token, { selfNote: "Nội dung bổ sung đã kiểm chứng" })).status, 200);
      assert.equal((await request("POST", `evaluations/${record.id}/supplement-submit`, unit.token, {})).status, 200);
      assert.equal((await request("POST", `${path}/accept-all`, h.adminToken, {})).status, 200);
    } else {
      await h.scheduler.run();
      assert.equal((await h.prisma.evaluation.findUniqueOrThrow({ where: { id: record.id } })).status, "SUPPLEMENT_EXPIRED");
    }
    assertProjection((await request("GET", `evaluations/${record.id}`, unit.token)).body, true);
  }
  assert.equal((await request("POST", `evaluation-periods/${periodId}/transition-phase`, h.adminToken, { phase: "FINAL_REVIEW" })).status, 200);
  for (const record of records) {
    assert.equal((await request("POST", `admin/evaluations/${record.id}/finalize`, h.adminToken, {})).status, 200);
    const saved = await h.prisma.evaluation.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(saved.finalScore?.toNumber(), 85.01); assert.equal(saved.finalRating, "EXCELLENT");
    assert.equal(await h.prisma.statusHistory.count({ where: { evaluationId: record.id, toStatus: "FINALIZED" } }), 1);
    const history = await request("GET", `evaluations/${record.id}/status-history`, units.find((unit) => unit.id === record.unitId)!.token);
    assert.equal(history.status, 200); assertProjection(history.body);
  }
  assert.equal((await request("GET", `admin/dashboard?periodId=${periodId}`)).status, 200);
  for (const format of ["XLSX", "PDF", "DOCX"]) {
    const report = await request("POST", "admin/reports/exports", h.adminToken, { periodId, format, reportType: format === "XLSX" ? "SUMMARY_ALL_UNITS" : "UNIT_APPRAISAL_MINUTES", ...(format === "XLSX" ? {} : { evaluationId: records[0].id }) });
    assert.equal(report.status, 201); assertProjection(report.body);
    const download = await fetch(`${h.base}${report.body.downloadUrl}`, { headers: { authorization: `Bearer ${h.adminToken}` } });
    assert.equal(download.status, 200); const bytes = Buffer.from(await download.arrayBuffer());
    assert.ok(bytes.length > 500); assert.equal(bytes.subarray(0, format === "PDF" ? 4 : 2).toString(), format === "PDF" ? "%PDF" : "PK");
  }
  assert.equal((await request("GET", `admin/audit-logs?entity=Evaluation&entityId=${records[0].id}`)).status, 200);
  assert.equal((await request("POST", `evaluation-periods/${periodId}/transition-phase`, h.adminToken, { phase: "CLOSED" })).status, 200);
  evidence.goldenPath = { backend: "Nest/PostgreSQL/storage thật", imported: 2, finalized: 2, formats: ["XLSX", "PDF", "DOCX"], branches: ["SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"], externalProviders: "tắt" };
});

/** Kiểm refresh tranh chấp cùng token và reuse bằng HTTP, rồi kiểm mọi token sống trong DB
 * Một yêu cầu thắng rotation, yêu cầu còn lại phải thu hồi toàn bộ họ phiên thay vì trả lỗi rồi rollback
 */
test("VC17 refresh cạnh tranh và reuse không để lại refresh token còn hiệu lực", async () => {
  const login = await request("POST", "auth/login", "", { username: h.username, password: h.password });
  const results = await Promise.all([1, 2].map(() => request("POST", "auth/refresh", "", { refreshToken: login.body.refreshToken })));
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 401]);
  assert.equal(await h.prisma.refreshToken.count({ where: { userId: h.adminId, revokedAt: null } }), 0);
  const winner = results.find((item) => item.status === 200)!;
  assert.equal((await request("POST", "auth/refresh", "", { refreshToken: winner.body.refreshToken })).status, 401);
  evidence.refreshRace = { success: 1, rejected: 1, liveRefreshTokens: 0 };
});

/** Kiểm chính sách mật khẩu bằng DTO, Auth service và bcrypt thật qua HTTP
 * Các biên ký tự và byte được tách riêng, mật khẩu hợp lệ nối tiếp nhau để kiểm hash cũ và thu hồi phiên
 * Không ghi plaintext hoặc hash vào báo cáo, chỉ giữ số lượng trường hợp và tên các biên đã kiểm
 */
test("VC17 mật khẩu 7/8/9/10 ký tự, Unicode và 72/73 byte qua HTTP thật", async () => {
  const scenario = await h.scenario(); const account = scenario.records[0];
  let password = h.password; let token = account.token;
  const invalid = ["Chu1234", "12345678", "password1", account.username, password, "đ".repeat(35) + "ab1"];
  assertProjection((await request("GET", "auth/me", token)).body);
  assertProjection((await request("GET", "users")).body);
  for (const candidate of invalid) assert.equal((await request("POST", "auth/change-password", token, { currentPassword: password, newPassword: candidate })).status, 400);
  for (const candidate of ["Chu12345", "Chua12345", "Chuab12345", "Mậtkhẩu9", "đ".repeat(35) + "a1"]) {
    const changed = await request("POST", "auth/change-password", token, { currentPassword: password, newPassword: candidate });
    assert.equal(changed.status, 200); assertProjection(changed.body, false, true);
    assert.equal((await request("GET", "auth/me", token)).status, 401);
    const user = await h.prisma.user.findUniqueOrThrow({ where: { id: account.userId } });
    assert.equal(await bcrypt.compare(candidate, user.passwordHash), true);
    password = candidate; token = changed.body.accessToken;
  }
  evidence.password = { invalid: invalid.length, valid: 5, boundaries: ["7/8/9/10 ký tự", "Unicode", "72/73 byte", "username", "hash cũ", "phổ biến", "thu hồi access cũ"] };
});

/** Ép cả hai thứ tự gửi/reset bằng cổng chờ trong provider giả, DB và reset HTTP vẫn thật
 * Reset thắng làm claim cũ không gửi, gửi thắng giữ khóa user tới khi gửi xong rồi reset mới tăng version
 * Không cần provider ngoài và không biến hai thứ tự hợp lệ thành cam kết thu hồi thư đã gửi
 */
test("VC17 reset và gửi credential tuần tự theo khóa user, claim cũ không gửi sau reset", async () => {
  const config = h.app.get(ConfigService); config.set("EMAIL_ENABLED", true);
  const dist = new URL("../../dist/", import.meta.url);
  const { EmailNotificationProvider: EmailToken } = await import(new URL("modules/notifications/real-notification-providers.js", dist).href);
  const email = h.app.get<EmailNotificationProvider>(EmailToken); const original = email.send.bind(email);
  let calls = 0;
  try {
    for (const sendFirst of [false, true]) {
      const suffix = randomUUID().slice(0, 8); const address = `vc17-${suffix}@example.invalid`;
      const user = await request("POST", "users", h.adminToken, { username: `vc17-race-${suffix}`, fullName: "Người kiểm race credential", role: "ADMIN", email: address });
      assert.equal(user.status, 201);
      assert.equal((await request("POST", `users/${user.body.id}/credential-deliveries/confirm-email`, h.adminToken, { email: address })).status, 200);
      const claim = await h.credentials.claimOne(); assert.ok(claim);
      let entered!: () => void; const sending = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
      email.send = async () => { calls++; entered(); await gate; return { kind: "sent", providerMessageId: "vc17-provider-gia" }; };
      const before = calls;
      if (sendFirst) {
        const work = h.credentials.processClaim(claim); await sending;
        const reset = request("POST", `users/${user.body.id}/reset-password`, h.adminToken, {});
        // Chỉ mở cổng provider sau khi PostgreSQL xác nhận reset thật sự đang chờ khóa user
        // Điều kiện này ngăn bài kiểm vô tình chạy tuần tự do request reset chưa tới backend
        try {
          const until = Date.now() + 10000; let waiting = false;
          while (Date.now() < until && !waiting) {
            const rows = await h.prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%users%') AS waiting`;
            waiting = rows[0].waiting;
            if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
          }
          assert.equal(waiting, true, "Reset phải chờ khóa user trong lúc provider đang gửi");
        } finally { release(); }
        await work; assert.equal((await reset).status, 200); assert.equal(calls, before + 1);
      } else {
        assert.equal((await request("POST", `users/${user.body.id}/reset-password`, h.adminToken, {})).status, 200);
        release(); await h.credentials.processClaim(claim); assert.equal(calls, before);
      }
      const saved = await h.prisma.user.findUniqueOrThrow({ where: { id: user.body.id } });
      assert.equal(saved.credentialVersion, 1);
      const canceled = await h.prisma.credentialDispatch.findUniqueOrThrow({ where: { userId_credentialVersion: { userId: saved.id, credentialVersion: 0 } } });
      assert.ok(canceled.canceledAt); assert.equal(canceled.ciphertext, null);
      // Hủy dispatch mới của fixture trước lượt tiếp để claimOne chỉ thấy công việc do test đang điều phối
      await h.prisma.$transaction((tx) => h.credentials.cancelForUser(tx, saved.id));
    }
    evidence.resetCredentialRace = { orders: 2, provider: "giả trong test", staleClaimSent: 0 };
  } finally { email.send = original; config.set("EMAIL_ENABLED", false); }
});

/** Liệt kê từ metadata Nest đã đăng ký để route ID mới không bị bỏ qua trong bảng kiểm
 * Mỗi route được gọi không phiên và sai vai trò hoặc sai chủ; tuyến storage kiểm capability thay JWT
 * Các body cố ý đúng cấu trúc tối thiểu để đi qua DTO và thật sự kiểm scope tài nguyên
 */
test("VC17 kiểm mọi route có ID bằng phiên sai vai trò hoặc UNIT khác", async () => {
  const sample = await h.scenario(2); const owner = sample.records[0]; const foreign = sample.records[1];
  const ownEvidence = await h.prisma.evidence.findFirstOrThrow({ where: { criterionScore: { evaluationId: owner.evaluationId } } });
  const ownNotice = await h.prisma.$transaction((tx) => h.notifications.notifyUser(tx, { userId: owner.userId, type: "VC17_SCOPE", title: "Thông báo kiểm quyền", body: "Chỉ đúng chủ được đọc", channels: [] }));
  const rows: Array<{ method: string; route: string; unauthenticated: number; denied: number; wrongRole?: number }> = [];
  const modules = h.app.get(ModulesContainer);
  for (const module of modules.values()) for (const wrapper of module.controllers.values()) {
    const type = wrapper.metatype; if (!type) continue;
    const prefix = Reflect.getMetadata(PATH_METADATA, type) as string;
    for (const name of Object.getOwnPropertyNames(type.prototype)) {
      const handler: unknown = (type.prototype as Record<string, unknown>)[name]; if (typeof handler !== "function") continue;
      const suffix = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const methodId: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      if (suffix === undefined || typeof methodId !== "number") continue;
      // Metadata có thể chứa suffix "/", chuẩn hóa toàn bộ dấu kết thúc trước khi chọn body theo route
      // URL Nest tương đương nhau nhưng bảng kiểm cần cùng một tên để thực sự đi tới nhánh kiểm quyền
      const route = `${prefix}/${suffix}`.replace(/\/+$/u, ""); if (!route.includes(":")) continue;
      const method: string = RequestMethod[methodId];
      const roles = (Reflect.getMetadata("authorizedRoles", handler) ?? Reflect.getMetadata("authorizedRoles", type)) as string[] | undefined;
      const replacements: Record<string, string> = { evaluationId: owner.evaluationId, periodId: randomUUID(), criterionId: sample.leaf1, id: route.includes("/users/") ? owner.userId : route.includes("/units/") ? owner.unitId : randomUUID(), evidenceId: ownEvidence.id, uploadId: randomUUID(), notificationId: ownNotice.id, importId: randomUUID() };
      const path = route.replace(/^api\/v1\//u, "").replace(/:([A-Za-z]+)/gu, (_match, key: string) => replacements[key] ?? randomUUID());
      const noSession = await request(method, path, "", method === "GET" || method === "DELETE" ? undefined : {});
      const capability = route.startsWith("api/v1/storage/");
      if (capability) assert.ok([403, 404].includes(noSession.status), `${method} ${route} phải chặn capability không hợp lệ`);
      else assert.equal(noSession.status, 401, `${method} ${route}`);
      let body: unknown = {};
      if (route === "api/v1/users/:id" && method === "PATCH") body = { fullName: "Không được sửa tên tài khoản đơn vị khác" };
      if (route.endsWith("/self")) body = { selfScore: 1 };
      else if (route.endsWith("self-batch")) body = { items: [{ criterionId: sample.leaf1, selfScore: 1 }] };
      else if (route.endsWith("/feedback") && method === "POST") body = { type: "UNIT_REPLY", content: "Không được gửi sang hồ sơ đơn vị khác" };
      else if (route.endsWith("/evidences") && method === "POST") body = { items: [{ kind: "LINK", criterionId: sample.leaf1, externalUrl: "https://example.com/kiem-quyen" }] };
      else if (route.endsWith("upload-urls")) body = { items: [{ criterionId: sample.leaf1, fileName: "bao-cao.pdf", mimeType: "application/pdf", sizeBytes: 100 }] };
      // Tuyến chỉ UNIT cần thử cả ADMIN sai vai trò lẫn UNIT đúng vai trò nhưng sai chủ tài nguyên
      const wrongRole = roles?.length === 1 && roles[0] === "UNIT" ? await request(method, path, h.adminToken, method === "GET" || method === "DELETE" ? undefined : body) : undefined;
      if (wrongRole) assert.equal(wrongRole.status, 403, `${method} ${route} phải chặn ADMIN trên thao tác UNIT`);
      const denied = await request(method, path, foreign.token, method === "GET" || method === "DELETE" ? undefined : body);
      const nested = denied.body.results?.[0]?.error;
      assert.ok([403, 404].includes(denied.status) || (denied.status === 200 && nested && [403, 404].includes((nested as unknown as { statusCode: number }).statusCode)), `${method} ${route} phải chặn scope hoặc vai trò, nhận ${denied.status}`);
      rows.push({ method, route, unauthenticated: noSession.status, denied: nested ? (nested as unknown as { statusCode: number }).statusCode : denied.status, ...(wrongRole ? { wrongRole: wrongRole.status } : {}) });
    }
  }
  assert.ok(rows.length >= 35, "Danh mục phải chứa đầy đủ route ID đang đăng ký");
  evidence.idRoutes = rows;
});

/** Đi qua ValidationPipe thật với lỗi lồng nhau và đầu vào cố nhét trường hệ thống
 * Kiểm đường dẫn trường có chỉ số, thông điệp Việt và DB không thay đổi sau cả request lỗi
 */
test("VC17 nested validation và mass assignment không làm thay đổi điểm hoặc rò giá trị", async () => {
  const sample = await h.scenario(); const record = sample.records[0];
  const path = `evaluations/${record.evaluationId}/scores/self-batch`;
  const before = await h.prisma.criterionScore.findMany({ where: { evaluationId: record.evaluationId }, orderBy: { id: "asc" } });
  const result = await request("PUT", path, record.token, { items: [{ criterionId: sample.leaf1, selfScore: "gia-tri-bi-mat-khong-duoc-phan-chieu", adminScore: 100 }] });
  assert.equal(result.status, 400);
  const details = (result.body as unknown as { details: Array<{ field: string }> }).details;
  assert.ok(details.some((item) => item.field.includes("items") && item.field.includes("selfScore")));
  assert.ok(!JSON.stringify(result.body).includes("gia-tri-bi-mat"));
  assert.deepEqual(await h.prisma.criterionScore.findMany({ where: { evaluationId: record.evaluationId }, orderBy: { id: "asc" } }), before);
  evidence.nestedValidation = { status: 400, fieldPaths: details.map((item) => item.field), databaseUnchanged: true };
});

/** Đọc kiểu thực từ adapter Prisma rồi dùng serializer sản phẩm, không thay bằng object giả
 * Instant UTC có phần mili giây, Decimal có phần lẻ và BigInt vượt ngưỡng an toàn đều phải round-trip chính xác
 */
test("VC17 round-trip Prisma UTC, Decimal và BigInt lớn qua serializer thật", async () => {
  const rows = await h.prisma.$queryRaw<Array<{ instant: Date; decimal: Prisma.Decimal; large: bigint }>>`SELECT timestamp '2026-12-31 17:00:00.123' AS instant, 85.01::numeric AS decimal, 9007199254740993::bigint AS large`;
  assert.equal(rows[0].instant.toISOString(), "2026-12-31T17:00:00.123Z");
  assert.equal(typeof rows[0].large, "bigint"); assert.equal(rows[0].decimal.toString(), "85.01");
  assert.deepEqual(JSON.parse(JSON.stringify(serializeApiValue(rows[0]))), { instant: "2026-12-31T17:00:00.123Z", decimal: 85.01, large: "9007199254740993" });
  evidence.roundtrip = { timezone: "UTC", decimal: "85.01", largeInteger: "9007199254740993" };
});

/** Cho hai instance worker tranh một delivery đang tới hạn gửi lại trên PostgreSQL thật
 * Tạm hoãn các delivery thuộc fixture trước, khôi phục lịch trong finally để mỗi claim chỉ tranh việc cần đo
 * Provider giả chỉ thay lời gọi mạng, claim, backoff, token, audit và kết quả SENT đều dùng service/DB thật
 */
test("VC17 hai worker retry chỉ gửi một lần và token cũ không ghi đè kết quả", async () => {
  const paused = await h.prisma.notificationDelivery.findMany({ where: { status: "PENDING" }, select: { id: true, nextAttemptAt: true } });
  await h.prisma.notificationDelivery.updateMany({ where: { id: { in: paused.map((row) => row.id) } }, data: { nextAttemptAt: new Date(Date.now() + 3600000) } });
  let sends = 0;
  const provider = { channel: "EMAIL" as const, resolveRecipient: async () => true, send: async () => { sends++; return { kind: "sent" as const }; } };
  const workers = [1, 2].map(() => new NotificationsService(h.prisma, new ConfigService({ ZALO_ZNS_ENABLED: false }), [provider], h.audit));
  try {
    const notice = await h.prisma.$transaction((tx) => h.notifications.notifyUser(tx, { userId: h.adminId, type: "VC17_RETRY_RACE", title: "Kiểm tra gửi lại cạnh tranh", body: "Chỉ được xử lý một lần trong lượt thử", channels: ["EMAIL"] }));
    const original = await workers[0].claimOne(); assert.equal(original?.id, notice.deliveries[0].id);
    assert.equal(await workers[0].finishClaim(original!, 0, { kind: "retry", reasonCode: "TEMPORARY_FAILURE", message: "Lỗi tạm được mô phỏng trong bộ kiểm" }), true);
    await h.prisma.notificationDelivery.update({ where: { id: original!.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const claims = await Promise.all(workers.map((worker) => worker.claimOne()));
    assert.equal(claims.filter(Boolean).length, 1);
    const winner = claims.find((claim) => claim !== null)!; assert.equal(winner.id, original!.id); assert.notEqual(winner.claim_token, original!.claim_token);
    await workers[claims[0] ? 0 : 1].processClaim(winner);
    assert.equal(await workers[0].finishClaim(original!, 0, { kind: "retry", reasonCode: "TEMPORARY_FAILURE", message: "Kết quả worker cũ phải bị bỏ qua" }), false);
    const saved = await h.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: winner.id } });
    assert.equal(saved.status, "SENT"); assert.equal(saved.attemptCount, 2); assert.equal(saved.claimToken, null); assert.equal(sends, 1);
    assert.equal(await h.prisma.auditLog.count({ where: { entityId: winner.id, action: "NOTIFICATION_DELIVERY" } }), 2);
    evidence.retryWorkers = { workers: 2, successfulClaims: 1, providerCalls: sends, attempts: saved.attemptCount, staleCompletionAccepted: false, auditEntries: 2 };
  } finally {
    // Chỉ khôi phục nextAttemptAt của những bản ghi fixture đã tạm hoãn, không reset bảng hoặc thay trạng thái
    for (const row of paused) await h.prisma.notificationDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: row.nextAttemptAt } });
  }
});

/** Đo 34 danh tính UNIT cùng lưu trong một kỳ và 34 lượt đọc dashboard ADMIN thật
 * Local hiệu chuẩn năm mẫu tuần tự trước tải, ngân sách ba lần 34 mẫu cơ sở và sàn hai giây
 * CI giữ ngân sách cố định 15 giây qua env, không chấp nhận lỗi và không đổi ngưỡng sau khi thấy p95 tải
 * PostgreSQL ghi log câu chậm qua cấu hình container và pg_stat_statements do runner bật riêng
 */
test("VC17 tải nhẹ 34 người lưu và đọc dashboard có số đo p95 và hậu điều kiện DB", async () => {
  await h.prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  type QuerySample = { queryid: string; calls: string; total: number; maximum: number };
  // Chỉ lấy ID truy vấn và số đo từ extension của DB thử, không xuất raw SQL hoặc giá trị tham số
  const queryStatistics = () => h.prisma.$queryRawUnsafe<QuerySample[]>("SELECT queryid::text, calls::text, total_exec_time AS total, max_exec_time AS maximum FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())");
  const sample = await h.scenario(34, 100, [50, 35], false);
  // Hiệu chuẩn trước khi chạy đồng thời để ngưỡng phản ánh máy thực tế thay vì lấy con số chưa đo
  // Thao tác khởi động dùng đúng HTTP và transaction, lượt tải sau vẫn phải ghi đủ mọi tài khoản
  const calibration: number[] = [];
  for (let index = 0; index < 5; index++) {
    const started = performance.now(); const first = sample.records[0];
    assert.equal((await request("PUT", `evaluations/${first.evaluationId}/scores/${sample.leaf1}/self`, first.token, { selfScore: 20, selfNote: "Hiệu chuẩn trước kiểm tải" })).status, 200);
    assert.equal((await request("GET", `admin/dashboard?periodId=${sample.periodId}`)).status, 200);
    calibration.push(performance.now() - started);
  }
  calibration.sort((a, b) => a - b);
  const baselineMs = calibration[2];
  const thresholdMs = Number(process.env.VC17_LOAD_P95_MS ?? Math.max(2000, Math.ceil(baselineMs * 34 * 3)));
  const before = new Map((await queryStatistics()).map((row) => [row.queryid, row]));
  const samples: number[] = []; let errors = 0;
  await Promise.all(sample.records.map(async (record, index) => {
    for (let iteration = 0; iteration < 3; iteration++) {
      const started = performance.now();
      const saved = await request("PUT", `evaluations/${record.evaluationId}/scores/${sample.leaf1}/self`, record.token, { selfScore: 20 + index / 100, selfNote: `Lượt tải ${iteration}` });
      const dashboard = await request("GET", `admin/dashboard?periodId=${sample.periodId}`);
      samples.push(performance.now() - started); if (saved.status !== 200 || dashboard.status !== 200) errors++;
    }
  }));
  samples.sort((a, b) => a - b); const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  const queries = (await queryStatistics()).map((row) => ({ id: row.queryid, calls: Number(row.calls) - Number(before.get(row.queryid)?.calls ?? 0), totalMs: row.total - (before.get(row.queryid)?.total ?? 0), maximumMsSinceStart: row.maximum })).filter((row) => row.calls > 0).sort((a, b) => b.totalMs - a.totalMs);
  evidence.load = { users: 34, requests: samples.length * 2, iterations: 3, baselineMedianMs: Math.round(baselineMs), thresholdSource: process.env.VC17_LOAD_P95_MS ? "Cấu hình trước khi chạy" : "max(2000, median hiệu chuẩn × 34 × 3), tính trước tải", p95Ms: Math.round(p95), maximumMs: Math.round(samples.at(-1)!), errors, thresholdMs, measurement: "Một mẫu gồm một lượt lưu rồi một lượt đọc dashboard", databaseQueries: queries.reduce((sum, row) => sum + row.calls, 0), slowQueryThresholdMs: 250, queryStatistics: queries.slice(0, 10), queryMaximumAtLeast250Ms: queries.filter((row) => row.maximumMsSinceStart >= 250).length };
  assert.equal(errors, 0); assert.ok(p95 < thresholdMs, `p95 ${Math.round(p95)} ms phải nhỏ hơn ngưỡng ${thresholdMs} ms đã cấu hình`);
  for (const [index, record] of sample.records.entries()) {
    const score = await h.prisma.criterionScore.findUniqueOrThrow({ where: { evaluationId_criterionId: { evaluationId: record.evaluationId, criterionId: sample.leaf1 } } });
    assert.equal(score.selfScore?.toNumber(), 20 + index / 100); assert.equal(score.selfNote, "Lượt tải 2");
  }
});
