import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { chromium } from "playwright";
import { setTimeout } from "node:timers";

const origin = process.env.DEPLOY_VERIFY_ORIGIN ?? "https://localhost:18444";
if (process.env.DEPLOY_RESTORE_SMOKE_ENABLED !== "true" || !["https://localhost:18443", "https://localhost:18444"].includes(origin)) throw new Error("Chỉ kiểm source/restore local được tạo riêng sau khi có kết quả deployment");
const accounts = JSON.parse(await readFile(".tmp/deployment-private.json", "utf8"));
const source = JSON.parse(await readFile(".tmp/deployment-results.json", "utf8"));
if (!source.passed) throw new Error("Cần lượt deployment đã đạt trước khi đối chiếu restore");
const suffix = new URL(origin).port;
const report = { origin, checks: [], passed: false, mockBackend: false };
const directory = `.tmp/deployment-verify-${suffix}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
let stage = "HTTPS";
try {
  const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  const unitContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 1000 } });
  const admin = await adminContext.newPage(); const unit = await unitContext.newPage();
  admin.setDefaultTimeout(90000); unit.setDefaultTimeout(90000);
  for (const [page, account, role] of [[admin, accounts.admin, "admin"], [unit, accounts.unit, "unit"]]) {
    stage = `đăng nhập ${role}`;
    await page.goto(origin + "/login");
    await page.locator('form input[type="text"]').fill(account.username);
    await page.locator('form input[type="password"]').fill(account.password);
    await page.locator('form button[type="submit"]').click(); await page.waitForURL(`**/${role}/dashboard`);
  }
  const adminToken = await admin.evaluate(() => globalThis.sessionStorage.getItem("accessToken"));
  const unitToken = await unit.evaluate(() => globalThis.sessionStorage.getItem("accessToken"));
  async function get(path, token = adminToken) {
    const response = await admin.request.get(`${origin}/api/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok()) throw new Error("HTTP chưa đạt");
    return response.json();
  }
  if (!(await get("auth/me")).id || !(await get("auth/me", unitToken)).id) throw new Error("Không đọc được phiên sau restore");
  report.checks.push("twoRoleLoginAndMe");
  stage = "kết quả hồ sơ và báo cáo";
  const record = await get(`evaluations/${source.evaluationId}`, unitToken);
  const summary = await get(`evaluations/${source.evaluationId}/score-summary`, unitToken);
  if (record.status !== "FINALIZED" || summary.finalResult.score !== 75 || summary.finalResult.rating !== "GOOD") throw new Error("Kết quả chốt sau restore không khớp");
  for (const item of source.reports) {
    const metadata = await get(`admin/reports/exports/${item.id}`);
    const response = await admin.request.get(new URL(metadata.downloadUrl, origin).href, { headers: { Authorization: `Bearer ${adminToken}` } });
    const hash = createHash("sha256").update(await response.body()).digest("hex");
    if (!response.ok() || hash !== item.sha256) throw new Error("Bytes báo cáo sau restore không khớp");
  }
  const evidence = await get(`evaluations/${source.evaluationId}/evidences/${source.evidenceId}`, unitToken);
  const response = await admin.request.get(new URL(evidence.downloadUrl, origin).href);
  if (!response.ok() || createHash("sha256").update(await response.body()).digest("hex") !== source.evidenceSha256) throw new Error("Bytes minh chứng sau restore không khớp");
  report.checks.push("finalResultEvidenceAndAllReportHashes");
  stage = "browser desktop và mobile sau tải dữ liệu";
  for (const [page, path, apiPath, role] of [[admin, `/admin/dashboard?periodId=${source.periodId}`, "/api/v1/admin/dashboard", "admin"], [unit, `/unit/records?periodId=${source.periodId}`, `/api/v1/evaluations/${source.evaluationId}`, "unit"]]) {
    const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === apiPath && response.request().method() === "GET" && response.status() === 200);
    await page.goto(origin + path); await loaded;
    // HTTP hoàn tất chưa bảo đảm React đã vẽ dữ liệu, phải chờ nội dung thật trước kiểm responsive và chụp ảnh
    await page.getByText(role === "admin" ? "Tổng hồ sơ kỳ" : /Kết quả đã chốt: 75 điểm/u, { exact: role === "admin" }).waitFor();
    if (role === "unit") {
      await page.getByText(/^Lịch bổ sung:/u).waitFor();
      if (await page.getByText(/Chờ giảng viên xác nhận|Lịch bổ sung \(tạm\)|Lịch bổ sung tạm/u).count()) throw new Error("Giao diện còn nhãn chính sách lịch cũ");
      report.checks.push("renderedFinalResultAndCurrentSupplementLabels");
    }
    await page.locator(".ant-skeleton").first().waitFor({ state: "hidden" });
    await page.screenshot({ path: `${directory}/${role}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await new Promise((done) => setTimeout(done, 300));
    if (await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1)) throw new Error("Trang tràn ngang trên mobile");
    // Không chỉ kiểm chiều ngang: nút tài khoản phải còn trong header, không bị Space tự xuống hàng và che bởi nội dung
    const headerBox = await page.locator("header").boundingBox();
    const accountBox = await page.getByRole("button", { name: "Mở tùy chọn tài khoản", exact: true }).boundingBox();
    if (!headerBox || !accountBox || accountBox.y < headerBox.y || accountBox.y + accountBox.height > headerBox.y + headerBox.height + 1 || accountBox.x < headerBox.x || accountBox.x + accountBox.width > 391) throw new Error("Nút tài khoản bị khuất trên mobile");
    await page.screenshot({ path: `${directory}/${role}-mobile.png`, fullPage: true });
  }
  report.checks.push("loadedTwoRoleDesktopMobileNoOverflow"); report.passed = true;
} catch { report.failedStage = stage; process.exitCode = 1; }
finally { await browser.close(); report.completedAt = new Date().toISOString(); await writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
