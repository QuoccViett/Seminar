import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { setTimeout } from "node:timers";
import dotenv from "dotenv";
import { chromium } from "playwright";
import PDFDocument from "pdfkit";

// Chỉ chạy trên Compose demo local được tạo riêng, không nhận URL production hoặc bật provider thật
const origin = process.env.DEPLOY_SMOKE_ORIGIN ?? "https://localhost:18443";
const env = dotenv.parse(await readFile(resolve("../deploy/.env")));
if (process.env.DEPLOY_SMOKE_ENABLED !== "true" || new URL(origin).hostname !== "localhost" || new URL(origin).protocol !== "https:" || env.RUNTIME_ENV !== "development" || env.STORAGE_PROVIDER !== "local" || [env.EMAIL_ENABLED, env.WEB_PUSH_ENABLED].includes("true")) throw new Error("Cần cờ kiểm và Compose demo local riêng, storage local, các kênh ngoài tắt");
const privatePath = ".tmp/deployment-private.json";
const report = { origin, checks: [], mockBackend: false, externalProviders: false };
let stage = "khởi tạo"; let browser; let admin; let unit; let activeUnits = []; let adminToken;
const accounts = { admin: { username: "admin", password: env.SEED_ADMIN_PASSWORD }, unit: { username: "coso01", password: env.INITIAL_ACCOUNT_PASSWORD } };
try {
  const previous = JSON.parse(await readFile(privatePath, "utf8"));
  if (process.env.DEPLOY_SMOKE_RESUME !== "true" || previous.admin?.username !== "admin" || previous.unit?.username !== "coso01") throw new Error("Cần cờ resume rõ ràng hoặc môi trường demo mới");
  Object.assign(accounts, previous);
} catch (error) { if (error.code !== "ENOENT") throw error; }

async function login(page, account, role) {
  await page.goto(`${origin}/login`);
  await page.locator('form input[type="text"]').fill(account.username);
  await page.locator('form input[type="password"]').fill(account.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/(?:change-password|admin\/dashboard|unit\/dashboard)(?:\?|$)/);
  if (new URL(page.url()).pathname === "/change-password") {
    const next = `Demo9-${randomBytes(16).toString("hex")}`;
    await page.locator('form input[type="password"]').nth(0).fill(account.password);
    await page.locator('form input[type="password"]').nth(1).fill(next);
    await page.locator('form input[type="password"]').nth(2).fill(next);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(`**/${role}/dashboard`);
    account.password = next;
    await writeFile(privatePath, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  }
  return page.evaluate(() => globalThis.sessionStorage.getItem("accessToken"));
}

async function api(method, path, body, token = adminToken, expected) {
  const response = await admin.request.fetch(`${origin}/api/v1/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { data: body }) });
  if (expected !== undefined ? response.status() !== expected : !response.ok()) { report.failure = { method, path, status: response.status() }; throw new Error(`HTTP ${response.status()}`); }
  return response.json();
}

async function until(timestamp) {
  while (Date.now() < timestamp) await new Promise((done) => setTimeout(done, Math.min(500, timestamp - Date.now())));
}

async function transition(periodId, phase) {
  const current = await api("GET", `evaluation-periods/${periodId}`);
  if (current.phase !== phase) await api("POST", `evaluation-periods/${periodId}/transition-phase`, { phase });
}

try {
  await mkdir(".tmp/deployment-artifacts", { recursive: true });
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  const unitContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
  admin = await adminContext.newPage(); unit = await unitContext.newPage();
  admin.setDefaultTimeout(90000); unit.setDefaultTimeout(90000);
  stage = "health, HTTPS và Swagger";
  if (!(await admin.request.get(`${origin}/api/v1/health`)).ok() || (await admin.request.get(`${origin}/api/docs-json`)).status() !== 404) throw new Error("Health hoặc Swagger");
  report.checks.push("httpsHealthSwaggerDisabled");
  stage = "đăng nhập và đổi mật khẩu hai vai trò";
  adminToken = await login(admin, accounts.admin, "admin");
  const unitToken = await login(unit, accounts.unit, "unit");
  if (!adminToken || !unitToken) throw new Error("Thiếu phiên");
  report.checks.push("realAdminUnitLoginAndForcedPasswordChange");
  stage = "kiểm dataset và cô lập kỳ smoke qua API";
  const units = (await api("GET", "units?page=1&pageSize=100")).items;
  if (units.length !== 34 || units.some((item) => !item.code.startsWith("COSO-DEMO-"))) throw new Error("Chỉ dùng dataset demo 34 đơn vị mới");
  const self = await api("GET", "auth/me", undefined, unitToken);
  // Cô lập một kỳ chỉ có UNIT trình diễn; cuối lượt khôi phục đúng 33 đơn vị còn lại bằng API
  activeUnits = units.filter((item) => item.id !== self.unitId && item.isActive);
  for (const item of activeUnits) await api("PATCH", `units/${item.id}`, { isActive: false });
  const existing = (await api("GET", "evaluation-periods?page=1&pageSize=100")).items;
  const now = Date.now(); const start = now + 7000; const deadline = now + 90000;
  const period = await api("POST", "evaluation-periods", { year: Math.max(2028, ...existing.map((item) => item.year)) + 1, name: "Kiểm triển khai HTTPS — một hồ sơ", maxTotalScore: 100, selfEvalStart: new Date(start).toISOString(), selfEvalDeadline: new Date(deadline).toISOString() });
  const criterion = await api("POST", `evaluation-periods/${period.id}/criteria`, { code: "SMOKE", name: "Kết quả và minh chứng triển khai", maxScore: 100, sortOrder: 1, allowText: true, allowFile: true, allowLink: true, evidenceRequired: true });
  await api("PUT", `evaluation-periods/${period.id}/thresholds`, ["EXCELLENT", "GOOD", "PASS", "FAIL"].map((rating, i) => ({ rating, label: ["Xuất sắc", "Tốt", "Đạt", "Chưa đạt"][i], minPercent: [90, 70, 45, 0][i], minExclusive: i === 0 })));
  await api("POST", `evaluation-periods/${period.id}/publish`, {});
  const records = (await api("GET", `evaluations?periodId=${period.id}&pageSize=100`)).items;
  if (records.length !== 1) throw new Error("Kỳ smoke cần đúng một hồ sơ");
  const id = records[0].id; report.periodId = period.id; report.evaluationId = id;
  await until(start);
  stage = "tự chấm và upload private thật";
  await api("PUT", `evaluations/${id}/scores/${criterion.id}/self`, { selfScore: 80, selfNote: "Kết quả triển khai và minh chứng do nhóm tự tạo" }, unitToken);
  const document = new PDFDocument(); const chunks = [];
  const pdfReady = new Promise((done) => { document.on("data", (part) => chunks.push(part)); document.on("end", () => done(Buffer.concat(chunks))); });
  document.font(resolve("assets/fonts/NotoSans-Regular.ttf")).text("Minh chứng kiểm triển khai HTTPS do nhóm tự tạo"); document.end();
  const bytes = await pdfReady;
  const grant = (await api("POST", `evaluations/${id}/evidences/upload-urls`, { items: [{ criterionId: criterion.id, fileName: "minh-chung-trien-khai.pdf", mimeType: "application/pdf", sizeBytes: bytes.length }] }, unitToken)).results[0];
  if (!grant.ok) throw new Error("Không cấp phiên upload");
  const upload = new URL(grant.data.uploadUrl, origin);
  if (upload.origin !== origin) throw new Error("URL upload ngoài origin kiểm thử");
  if (!(await admin.request.put(upload.href, { data: bytes, headers: { "Content-Type": "application/pdf" } })).ok()) throw new Error("Không upload được bytes");
  const evidence = (await api("POST", `evaluations/${id}/evidences`, { items: [{ criterionId: criterion.id, kind: "FILE", uploadId: grant.data.uploadId }] }, unitToken)).results[0];
  if (!evidence.ok) throw new Error("Không xác nhận minh chứng");
  const metadata = await api("GET", `evaluations/${id}/evidences/${evidence.data.id}`, undefined, unitToken);
  const downloaded = await (await admin.request.get(new URL(metadata.downloadUrl, origin).href)).body();
  if (!downloaded.equals(bytes)) throw new Error("Bytes minh chứng không khớp");
  report.evidenceSha256 = createHash("sha256").update(bytes).digest("hex"); report.evidenceId = evidence.data.id;
  await api("POST", `evaluations/${id}/submit`, {}, unitToken);
  report.checks.push("selfSaveUploadConfirmPrivateDownloadAndSubmit");
  await until(deadline + 200);
  await api("PUT", `evaluations/${id}/scores/${criterion.id}/self`, { selfNote: "Không được ghi sau hạn" }, unitToken, 403);
  await transition(period.id, "FIRST_REVIEW");
  stage = "thẩm định, hai mốc bổ sung và retry";
  await api("PUT", `admin/evaluations/${id}/scores/${criterion.id}/review`, { adminScore: 70, adminComment: "Cần bổ sung giải trình kết quả" });
  await api("POST", `admin/evaluations/${id}/first-review-complete`, {});
  const supplementStart = Date.now() + 12000; const supplementDeadline = supplementStart + 120000;
  const request = { supplementStartAt: new Date(supplementStart).toISOString(), supplementDeadline: new Date(supplementDeadline).toISOString(), items: [{ criterionId: criterion.id, note: "Bổ sung giải trình triển khai" }] };
  await api("POST", "evaluation-periods/supplement-schedule/preview", { supplementStartAt: request.supplementStartAt, supplementDeadline: request.supplementDeadline });
  const requested = await api("POST", `admin/evaluations/${id}/supplement-request`, request);
  if (requested.supplementDeadline !== request.supplementDeadline) throw new Error("Snapshot bổ sung không khớp");
  await api("POST", `admin/evaluations/${id}/supplement-request`, request);
  await api("POST", `admin/evaluations/${id}/supplement-request`, { ...request, supplementDeadline: new Date(supplementDeadline + 60000).toISOString() }, adminToken, 409);
  await until(supplementStart);
  await api("PUT", `evaluations/${id}/scores/${criterion.id}/self`, { selfScore: 85, selfNote: "Đã bổ sung giải trình và kiểm lại minh chứng triển khai" }, unitToken);
  await api("POST", `evaluations/${id}/supplement-submit`, {}, unitToken);
  await api("PUT", `admin/evaluations/${id}/scores/${criterion.id}/review`, { adminScore: 75, adminComment: "Đã đối chiếu giải trình bổ sung, chấm 75 điểm" });
  await transition(period.id, "FINAL_REVIEW");
  const final = await api("POST", `admin/evaluations/${id}/finalize`, {});
  if (final.finalRating !== "GOOD" || final.finalScore !== 75) throw new Error("Kết quả chốt không khớp ngưỡng tùy chỉnh");
  report.checks.push("deadlineLockFlexibleSupplementRetrySubmitReviewFinalize");
  stage = "dashboard và bytes ba báo cáo";
  const leaderboard = await api("GET", `admin/dashboard/leaderboard?periodId=${period.id}`);
  if (leaderboard.items[0].suggestedRating !== "GOOD") throw new Error("Dashboard khác kết quả chốt");
  report.reports = [];
  for (const format of ["XLSX", "PDF", "DOCX"]) {
    const item = await api("POST", "admin/reports/exports", { periodId: period.id, reportType: format === "XLSX" ? "SUMMARY_ALL_UNITS" : "UNIT_APPRAISAL_MINUTES", format, ...(format === "XLSX" ? {} : { evaluationId: id }) });
    const response = await admin.request.get(new URL(item.downloadUrl, origin).href, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!response.ok()) throw new Error("Không tải được báo cáo");
    const content = await response.body(); await writeFile(`.tmp/deployment-artifacts/bao-cao.${format.toLowerCase()}`, content);
    report.reports.push({ id: item.id, format, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
  }
  for (const [page, path, label] of [[admin, `/admin/dashboard?periodId=${period.id}`, "admin"], [unit, `/unit/records?periodId=${period.id}`, "unit"]]) {
    const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === (label === "admin" ? "/api/v1/admin/dashboard" : `/api/v1/evaluations/${id}`) && response.status() === 200);
    await page.goto(origin + path); await loaded;
    await page.locator(".ant-skeleton").first().waitFor({ state: "hidden" });
    await page.screenshot({ path: `.tmp/deployment-artifacts/${label}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `.tmp/deployment-artifacts/${label}-mobile.png`, fullPage: true });
  }
  report.checks.push("dashboardReportsAndTwoRoleBrowserDesktopMobile"); report.passed = true;
} catch { report.passed = false; report.failedStage = stage; process.exitCode = 1; }
finally {
  if (adminToken) for (const item of activeUnits) { try { await api("PATCH", `units/${item.id}`, { isActive: true }); } catch { report.passed = false; report.failedStage = "khôi phục trạng thái đơn vị demo"; process.exitCode = 1; } }
  await browser?.close(); report.completedAt = new Date().toISOString(); await writeFile(".tmp/deployment-results.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, failedStage: report.failedStage }));
}
