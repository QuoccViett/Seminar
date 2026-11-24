import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL, URL } from "node:url";
import { setTimeout } from "node:timers";
import process from "node:process";
import console from "node:console";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

let stage = "khởi tạo";

/** Kiểm trải nghiệm hai vai trò qua Chrome, Nest và PostgreSQL thật trên loopback
 * Chỉ dữ liệu fixture VC16 được sửa qua DB, mọi thao tác nghiệp vụ thực hiện qua UI/API thật
 * Mạng lỗi chỉ ngắt request ghi cần kiểm, mạng chậm trì hoãn rồi chuyển tiếp, không fulfill response backend
 * Không gửi tin ngoài, không in token/password/URL ký; kết quả chỉ chứa các nhãn assertion cố định
 */
async function verify() {
  const fixture = JSON.parse(await readFile(".tmp/vc16-browser-state.json", "utf8"));
  const origin = process.env.VC16_FE_ORIGIN ?? "http://127.0.0.1:5186";
  const databaseUrl = process.env.VC16_TEST_DATABASE_URL;
  if (!databaseUrl || new URL(databaseUrl).pathname !== "/vc16_test" || ![origin, fixture.base, databaseUrl].every((url) => new URL(url).hostname === "127.0.0.1") || !/^vc12-admin-[a-f0-9]{8}$/.test(fixture.username)) throw new Error("Chỉ được kiểm bằng fixture VC16 local riêng");
  // Local có thể dùng Playwright và Chrome được chỉ định, CI dùng Chromium từ dependency đã khóa
  // Không bắt buộc đường dẫn Windows để cùng bài kiểm backend thật chạy được trên runner Linux
  const { chromium } = await import(process.env.VC16_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.VC16_PLAYWRIGHT_MODULE).href : "playwright");
  // Dùng Chromium đầy đủ ở chế độ headless mới để iframe PDF có cùng bộ xem tệp như Chrome thực tế
  // Đường dẫn Chrome được chỉ định vẫn được ưu tiên khi kiểm local, CI dùng binary đã tải từ lockfile Playwright
  const browser = await chromium.launch({ ...(process.env.VC16_CHROME_PATH ? { executablePath: process.env.VC16_CHROME_PATH } : { channel: "chromium" }), headless: true });
  const adminContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
  const unitContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1300, height: 1000 } });
  const admin = await adminContext.newPage(); const unit = await unitContext.newPage();
  admin.setDefaultTimeout(90000); unit.setDefaultTimeout(90000);
  admin.setDefaultNavigationTimeout(180000); unit.setDefaultNavigationTimeout(180000);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC" }) });
  const checks = [];
  const authResponses = [];
  const failedRequests = [];
  admin.on("requestfailed", (request) => { const url = new URL(request.url()); failedRequests.push({ path: url.pathname, code: request.failure()?.errorText }); });
  admin.on("response", (response) => { if (new URL(response.url()).pathname.includes("/auth/")) authResponses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await mkdir(".tmp/vc16-artifacts", { recursive: true });
  // Giữ cửa sổ DRAFT thử nghiệm còn hiệu lực khi các lượt chuẩn bị lâu trên máy thiếu RAM
  // Chỉ kéo mốc của đúng fixture trong vc16_test, không đổi trạng thái hoặc sửa DB ứng dụng dùng chung
  assert.equal((await prisma.evaluation.findUniqueOrThrow({ where: { id: fixture.open.evaluationId } })).status, "DRAFT", "Cần tạo fixture VC16 mới sau khi đã nộp hoặc khóa hồ sơ thử");
  await prisma.evaluationPeriod.update({ where: { id: fixture.open.periodId }, data: { selfEvalDeadline: new Date(Date.now() + 3600000) } });

  /** Đăng nhập qua form thật, dùng credential chỉ từ fixture và chờ route được bảo vệ */
  async function login(page, username, password, target) {
    await page.goto(`${origin}/login`);
    await page.locator('form input[type="text"]').fill(username);
    await page.locator('form input[type="password"]').fill(password);
    const [response] = await Promise.all([page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/login"), page.locator('form button[type="submit"]').click()]);
    assert.equal(response.status(), 200, "Đăng nhập fixture phải được backend xác nhận");
    console.log("VC16: đăng nhập fixture được backend xác nhận");
    await page.waitForURL(`**/${target}`);
  }

  /** Chọn kỳ qua giao diện trước khi thao tác hồ sơ tương ứng. */
  async function selectUnitPeriod(name) {
    await unit.waitForURL("**/unit/records");
    await unit.getByRole("heading", { name: "Hồ sơ tự chấm", exact: true, level: 2 }).waitFor();
    await unit.getByRole("combobox", { name: "Chọn đợt thi đua", exact: true }).click();
    await unit.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: name }).click();
  }

  /** Gửi lệnh API dưới danh tính ADMIN đã đăng nhập để tạo biến cố cạnh tranh lúc UNIT thao tác
   * Không dùng route kiểm thử trong ứng dụng, BE kiểm quyền và ghi audit như request thật
   */
  async function adminRequest(method, path, body) {
    return admin.evaluate(async ({ base, method, path, body }) => {
      const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("accessToken")}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }, { base: fixture.base, method, path, body });
  }

  try {
    // UUID kỳ trên URL phải đi theo menu và reload, báo cáo được đọc lại từ bytes tải thật
    // Không lấy giá trị từ state React để suy ra rằng chọn kỳ hoặc xuất file đã thành công
    stage = "đăng nhập ADMIN và kỳ theo URL"; console.log(`VC16: ${stage}`);
    await login(admin, fixture.username, fixture.password, "admin/dashboard");
    await admin.goto(`${origin}/admin/dashboard?periodId=${fixture.review.periodId}`);
    await admin.getByText("Kỳ thẩm định VC16", { exact: false }).first().waitFor();
    await admin.getByRole("menuitem", { name: /Báo cáo/u }).click();
    assert.equal(new URL(admin.url()).searchParams.get("periodId"), fixture.review.periodId);
    await admin.getByRole("button", { name: "Tạo báo cáo", exact: true }).waitFor();
    await admin.getByRole("button", { name: "Tạo báo cáo", exact: true }).click();
    await admin.getByText(/Đã tạo báo cáo/u).waitFor();
    const [reportDownload] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("button", { name: "Tải XLSX", exact: true }).first().click()]);
    const exported = new ExcelJS.Workbook(); await exported.xlsx.readFile(await reportDownload.path());
    assert.ok(exported.getWorksheet("Tổng hợp"));
    await admin.reload(); await admin.getByRole("button", { name: "Tạo báo cáo", exact: true }).waitFor();
    checks.push("adminPeriodAcrossPagesAndReload");

    // Mỗi màn phải nhận GET 200 đúng endpoint, menu hoặc tiêu đề hiện được chưa đủ chứng minh tích hợp
    stage = "các trang ADMIN thật"; console.log(`VC16: ${stage}`);
    for (const [path, text, apiPath] of [["units", "Quản lý đơn vị", "/units"], ["users", "Quản lý tài khoản", "/users"], ["config", "Cấu hình", "/evaluation-periods"], ["notifications", "Hộp thư", "/notifications"], ["audit-log", "Lịch sử", "/admin/audit-logs"]]) {
      stage = `màn ADMIN ${path}`; console.log(`VC16: ${stage}`);
      const incoming = admin.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1${apiPath}` && response.request().method() === "GET");
      await admin.goto(`${origin}/admin/${path}`);
      if (["users", "units"].includes(path)) {
        // Nếu máy demo ngắt request khi tải nặng, dùng đúng nút phục hồi mà người dùng nhìn thấy
        // Phản hồi cuối vẫn phải đến từ GET backend thật, không thay lỗi bằng dữ liệu mặc định
        const retry = admin.getByRole("button", { name: path === "users" ? "Thử tải lại tài khoản" : "Thử tải lại đơn vị", exact: true });
        const first = await Promise.race([incoming.then(() => "loaded"), retry.waitFor().then(() => "retry").catch(() => "missing")]);
        if (first === "retry") await retry.click();
      }
      const response = await incoming;
      assert.equal(response.status(), 200);
      await admin.getByText(new RegExp(text, "iu")).first().waitFor();
    }
    checks.push("adminScreens");

    // Đọc trạng thái thật từ PostgreSQL, dịch tên kênh/lý do mà vẫn giữ ý nghĩa chưa gửi
    await admin.goto(`${origin}/admin/notifications`);
    const noticeItem = admin.locator(".ant-list-item").filter({ hasText: "Kiểm nhãn trạng thái gửi VC16" });
    await noticeItem.getByRole("button", { name: "Trạng thái gửi", exact: true }).click();
    await admin.getByRole("dialog").getByText("Thông báo trình duyệt: Đã bỏ qua · Chưa đăng ký thiết bị nhận thông báo", { exact: true }).waitFor();
    assert.doesNotMatch(await admin.getByRole("dialog").innerText(), /WEB_PUSH|NO_SUBSCRIPTION|SKIPPED/u);
    await admin.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
    checks.push("notificationDeliveryUsesVietnameseLabels");

    // Lỗi tải danh sách phải còn cảnh báo sau khi toast hết, sau khi có mạng phải lấy dữ liệu mới từ BE
    await admin.goto(`${origin}/admin/users`);
    await admin.getByPlaceholder("Tìm tên đăng nhập, họ tên hoặc email").waitFor();
    await adminContext.setOffline(true);
    await admin.getByPlaceholder("Tìm tên đăng nhập, họ tên hoặc email").fill(fixture.username);
    await admin.getByPlaceholder("Tìm tên đăng nhập, họ tên hoặc email").press("Enter");
    await admin.getByRole("button", { name: "Thử tải lại tài khoản", exact: true }).waitFor();
    await adminContext.setOffline(false);
    const [recovered] = await Promise.all([admin.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/users"), admin.getByRole("button", { name: "Thử tải lại tài khoản", exact: true }).click()]);
    assert.equal(recovered.status(), 200);
    await admin.getByRole("cell", { name: fixture.username, exact: true }).waitFor();
    await admin.getByRole("cell", { name: "Quản trị viên", exact: true }).waitFor();
    checks.push("adminListNetworkErrorAndRealRetry");

    // Dữ liệu Excel chỉ có email miền thử, drop thật phải qua preview rồi confirm trước khi DB có user
    // Mọi kênh gửi đang tắt nên kết quả tạo không được suy diễn thành đã giao credential
    stage = "Import Excel kéo thả và trạng thái kênh tắt"; console.log(`VC16: ${stage}`);
    await admin.goto(`${origin}/admin/users`);
    const importButton = admin.getByRole("button", { name: /Import Excel/u });
    await importButton.waitFor();
    assert.equal(await importButton.evaluate((node) => window.getComputedStyle(node).color), "rgb(37, 50, 71)");
    assert.equal(await importButton.evaluate((node) => window.getComputedStyle(node).borderTopColor), "rgb(213, 220, 229)");
    stage = "Import: mở hộp thoại"; console.log(`VC16: ${stage}`);
    // Tên truy cập có thêm nhãn của icon upload, khớp phần chữ để vẫn thao tác bằng ngữ nghĩa nút
    await admin.getByRole("button", { name: /Import Excel/u }).click();
    await admin.locator(".ant-modal:visible").waitFor();
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Import UNIT");
    const suffix = randomUUID().slice(0, 8);
    sheet.addRow(["unitCode", "unitName", "unitType", "username", "fullName", "email", "phone"]);
    sheet.addRow([`VC16-${suffix}`, "Đơn vị nhập VC16", "DON_VI_TRUC_THUOC", `vc16-import-${suffix}`, "Đơn vị nhập VC16", `vc16-${suffix}@example.invalid`, "0900000001"]);
    // Tệp thiếu tên đơn vị phải báo đúng cột tiếng Việt và khóa confirm, preview chưa tạo tài khoản
    sheet.getCell("B2").value = "";
    await admin.locator('.ant-modal:visible input[type="file"]').setInputFiles({ name: "Danh sách có lỗi.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
    await admin.getByRole("button", { name: "Xem trước và kiểm tra", exact: true }).click();
    await admin.getByText(/1 dòng, 0 hợp lệ, 1 có lỗi/u).waitFor();
    await admin.getByText("Tên đơn vị: Tên đơn vị là bắt buộc.", { exact: false }).waitFor();
    assert.doesNotMatch(await admin.locator(".ant-modal:visible").innerText(), /\bREQUIRED\b|unitName là bắt buộc/u);
    assert.equal(await admin.getByRole("button", { name: "Xác nhận tạo tài khoản", exact: true }).isDisabled(), true);
    assert.equal(await prisma.user.count({ where: { username: `vc16-import-${suffix}` } }), 0);
    checks.push("importPreviewErrorsUseVietnameseFields");
    sheet.getCell("B2").value = "Đơn vị nhập VC16";
    const bytes = [...new Uint8Array(await workbook.xlsx.writeBuffer())];
    const transfer = await admin.evaluateHandle((bytes) => {
      const transfer = new DataTransfer();
      const file = new File([new Uint8Array(bytes)], "Danh sách VC16.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const item = transfer.items.add(file);
      // File sinh trong browser không có entry của hệ điều hành, Ant Upload duyệt entry thay vì đọc files trực tiếp
      // Adapter chỉ trả lại chính File có bytes thật cho nhánh kéo thả, không giả parser hoặc phản hồi backend
      Object.defineProperty(item, "webkitGetAsEntry", { value: () => ({ isFile: true, isDirectory: false, file: (callback) => callback(file) }) });
      return transfer;
    }, bytes);
    stage = "Import: thả tệp thật"; console.log(`VC16: ${stage}`);
    // Thả vào phần tử RC Upload bên trong vùng trang trí để sự kiện nổi lên đúng handler nhận file
    await admin.locator(".ant-upload-drag .ant-upload-btn").dispatchEvent("drop", { dataTransfer: transfer });
    stage = "Import: xem trước"; console.log(`VC16: ${stage}`);
    const [previewResponse] = await Promise.all([admin.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/users/import/preview"), admin.getByRole("button", { name: "Xem trước và kiểm tra", exact: true }).click()]);
    assert.ok(previewResponse.ok(), "Backend phải tiếp nhận workbook xem trước");
    await admin.getByText(/1 dòng, 1 hợp lệ, 0 có lỗi/u).waitFor();
    stage = "Import: xác nhận ghi"; console.log(`VC16: ${stage}`);
    await admin.getByRole("button", { name: "Xác nhận tạo tài khoản", exact: true }).click();
    await admin.getByText(/Đã tạo 1 tài khoản và 1 đơn vị mới/u).waitFor();
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { username: `vc16-import-${suffix}` } })).mustChangePassword, true);
    stage = "Import: đóng kết quả"; console.log(`VC16: ${stage}`);
    await admin.getByRole("button", { name: "Đóng", exact: true }).last().click();
    checks.push("realExcelDropPreviewConfirmDisabledChannels");

    stage = "Tạo danh sách Excel qua form thật"; console.log(`VC16: ${stage}`);
    const beforeGenerated = await prisma.user.count();
    await admin.getByRole("button", { name: /Import Excel/u }).click();
    await admin.getByRole("button", { name: "Tạo danh sách Excel", exact: true }).click();
    const generatorDialog = admin.getByRole("dialog", { name: "Tạo danh sách Excel", exact: true });
    await generatorDialog.getByLabel("Số lượng", { exact: true }).fill("1");
    await generatorDialog.getByLabel("Tiền tố mã đơn vị", { exact: true }).fill(`GEN-${suffix}`);
    await generatorDialog.getByLabel("Tiền tố tên đăng nhập", { exact: true }).fill(`gen-${suffix}`);
    await generatorDialog.getByLabel("Domain email", { exact: true }).fill("example.invalid");
    const [draftDownload] = await Promise.all([admin.waitForEvent("download"), generatorDialog.getByRole("button", { name: "Tải bản nháp Excel", exact: true }).click()]);
    const draftBook = new ExcelJS.Workbook(); await draftBook.xlsx.load(await readFile(await draftDownload.path()));
    assert.equal(draftBook.worksheets[0].getCell("D2").value, `gen-${suffix}001`);
    await generatorDialog.getByRole("button", { name: "Dùng bản nháp để xem trước", exact: true }).click();
    await admin.getByRole("button", { name: "Xem trước và kiểm tra", exact: true }).click();
    await admin.getByText(/1 dòng, 1 hợp lệ, 0 có lỗi/u).waitFor();
    assert.equal(await prisma.user.count(), beforeGenerated);
    await admin.getByRole("button", { name: "Xác nhận tạo tài khoản", exact: true }).click();
    await admin.getByText(/Đã tạo 1 tài khoản và 1 đơn vị mới/u).waitFor();
    assert.equal(await prisma.user.count(), beforeGenerated + 1);
    await admin.getByRole("button", { name: "Đóng", exact: true }).last().click();
    checks.push("generatedExcelDownloadPreviewConfirm");

    // Chỉ sửa tài khoản vừa import trong DB thử, kiểm cả xác nhận reset và trạng thái gửi chưa được tiếp nhận
    // Không xác nhận địa chỉ Email hoặc gọi retry provider, mật khẩu tạm chỉ được đọc trong modal một lần
    stage = "sửa tài khoản, đặt lại mật khẩu và khóa mở bằng UI"; console.log(`VC16: ${stage}`);
    const importedUsername = `vc16-import-${suffix}`;
    await admin.getByPlaceholder("Tìm tên đăng nhập, họ tên hoặc email").fill(importedUsername);
    await admin.getByPlaceholder("Tìm tên đăng nhập, họ tên hoặc email").press("Enter");
    const importedRow = admin.getByRole("row").filter({ has: admin.getByRole("cell", { name: importedUsername, exact: true }) });
    // Icon Ant góp thêm tên truy cập nên nút có icon được khớp theo phần chữ tiếng Việt ở cuối
    // Vẫn tìm theo role và ngữ nghĩa, không dùng tọa độ hoặc bỏ qua modal xác nhận thật
    await importedRow.getByRole("button", { name: /Sửa$/u }).click();
    await admin.getByRole("dialog").getByLabel("Họ và tên", { exact: true }).fill("Tài khoản đã sửa VC16");
    await admin.getByRole("dialog").getByRole("button", { name: "Lưu", exact: true }).click();
    await importedRow.getByRole("cell", { name: "Tài khoản đã sửa VC16", exact: true }).waitFor();
    await importedRow.getByRole("button", { name: /Đặt lại mật khẩu$/u }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Đặt lại", exact: true }).click();
    await admin.getByText("Mật khẩu tạm của tài khoản này:", { exact: true }).waitFor();
    assert.equal(await admin.getByRole("dialog").locator("input").inputValue(), "123456");
    await admin.getByRole("button", { name: "Đã ghi nhận", exact: true }).click();
    for (const button of ["Khóa", "Mở"]) {
      await importedRow.getByRole("button", { name: new RegExp(`${button}$`, "u") }).click();
      await admin.getByRole("dialog").getByRole("button", { name: "Xác nhận", exact: true }).click();
      await importedRow.getByRole("button", { name: new RegExp(`${button === "Khóa" ? "Mở" : "Khóa"}$`, "u") }).waitFor();
    }
    await importedRow.getByRole("button", { name: "Trạng thái gửi", exact: true }).click();
    await admin.getByText(/Chưa cấu hình khóa mã hóa để cấp tự động|Còn kênh chưa tiếp nhận thông tin đăng nhập/u).waitFor();
    await admin.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
    const importedUser = await prisma.user.findUniqueOrThrow({ where: { username: importedUsername } });
    assert.equal(importedUser.fullName, "Tài khoản đã sửa VC16"); assert.equal(importedUser.isActive, true); assert.equal(importedUser.mustChangePassword, true);
    checks.push("realUserEditResetStatusAndLockUnlock");

    // Đơn vị do import tạo phải sửa được từ form và reload từ API, không chỉ đổi nhãn trong bảng cục bộ
    stage = "sửa đơn vị bằng form thật"; console.log(`VC16: ${stage}`);
    await admin.goto(`${origin}/admin/units`);
    await admin.getByPlaceholder("Tìm mã hoặc tên đơn vị").fill(`VC16-${suffix}`);
    await admin.getByPlaceholder("Tìm mã hoặc tên đơn vị").press("Enter");
    await admin.getByRole("row").filter({ has: admin.getByRole("cell", { name: `VC16-${suffix}`, exact: true }) }).getByRole("button", { name: /Sửa$/u }).click();
    await admin.getByRole("dialog").getByLabel("Tên đơn vị", { exact: true }).fill("Đơn vị đã sửa qua UI VC16");
    await admin.getByRole("dialog").getByRole("button", { name: "Lưu", exact: true }).click();
    await admin.getByRole("cell", { name: "Đơn vị đã sửa qua UI VC16", exact: true }).waitFor();
    assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: importedUser.unitId } })).name, "Đơn vị đã sửa qua UI VC16");
    checks.push("realUnitEdit");

    // Tạo kỳ, ngưỡng mặc định, tiêu chí và công bố hoàn toàn qua giao diện để kiểm hợp đồng cấu hình
    // Chọn lịch đã mở và hạn tương lai, không giới hạn ngày trong tuần hay giờ mở tự chấm
    stage = "cấu hình kỳ, tiêu chí và công bố bằng UI"; console.log(`VC16: ${stage}`);
    await admin.goto(`${origin}/admin/config`);
    await admin.getByRole("button", { name: /Tạo kỳ thi mới/u }).click();
    await admin.getByRole("spinbutton", { name: "Ngưỡng Xuất sắc", exact: true }).waitFor();
    assert.doesNotMatch(await admin.locator("body").innerText(), /\b(?:EXCELLENT|GOOD|PASS|FAIL)\b/u);
    const configuredName = `Kỳ công bố từ UI VC16 ${suffix}`;
    const nextYear = (await prisma.evaluationPeriod.aggregate({ _max: { year: true } }))._max.year + 1;
    await admin.getByLabel("Tên kỳ thi đua", { exact: true }).fill(configuredName);
    await admin.getByLabel("Năm thi đua", { exact: true }).fill(String(nextYear));
    await admin.getByLabel("Tổng điểm tối đa", { exact: true }).fill("100");
    /** Định dạng thành phần lịch Việt Nam cho RangePicker, không dùng chuỗi này để quyết định quyền */
    function vietnamPickerDate(instant) {
      const value = new Date(instant + 7 * 3600000);
      return `${String(value.getUTCDate()).padStart(2, "0")}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${value.getUTCFullYear()} ${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
    }
    await admin.getByPlaceholder("Ngày giờ mở", { exact: true }).fill(vietnamPickerDate(Date.now() - 86400000));
    await admin.getByPlaceholder("Ngày giờ mở", { exact: true }).press("Enter");
    await admin.getByPlaceholder("Ngày giờ kết thúc", { exact: true }).fill(vietnamPickerDate(Date.now() + 86400000));
    // Enter xác nhận giá trị picker nhưng không được gửi form khi khoảng ngày chưa commit
    // Chờ popup đóng để tránh đua với hiệu ứng chuyển cảnh, DB chưa được có kỳ trước khi bấm lưu
    await admin.getByPlaceholder("Ngày giờ kết thúc", { exact: true }).press("Enter");
    await admin.locator(".ant-picker-dropdown:visible").waitFor({ state: "hidden" });
    assert.equal(await prisma.evaluationPeriod.count({ where: { year: nextYear } }), 0);
    await admin.getByRole("button", { name: /Lưu và chuyển sang Tiêu chí/u }).click();
    stage = "cấu hình: thêm tiêu chí"; console.log(`VC16: ${stage}`);
    await admin.getByRole("button", { name: /Thêm tiêu chí/u }).click();
    const criterionDialog = admin.getByRole("dialog");
    await criterionDialog.getByLabel("Mã tiêu chí", { exact: true }).fill("UI16");
    await criterionDialog.getByLabel("Tên tiêu chí", { exact: true }).fill("Tiêu chí tạo qua UI VC16");
    await criterionDialog.getByLabel("Điểm tối đa", { exact: true }).fill("100");
    stage = "cấu hình: lưu tiêu chí"; console.log(`VC16: ${stage}`);
    await criterionDialog.getByRole("button", { name: "Lưu tiêu chí", exact: true }).click();
    await admin.getByRole("cell", { name: "Tiêu chí tạo qua UI VC16", exact: true }).waitFor();
    await admin.getByRole("button", { name: /Hoàn tất & Quay lại danh sách/u }).click();
    const configuredRow = admin.getByRole("row").filter({ has: admin.getByRole("cell", { name: configuredName, exact: true }) });
    stage = "cấu hình: công bố"; console.log(`VC16: ${stage}`);
    await configuredRow.getByRole("button", { name: "Công bố", exact: true }).click();
    await admin.locator(".ant-popconfirm:visible").getByRole("button", { name: "Công bố", exact: true }).click();
    await admin.getByText("Đã công bố kỳ đánh giá", { exact: true }).waitFor();
    const configuredPeriod = await prisma.evaluationPeriod.findUniqueOrThrow({ where: { year: nextYear }, include: { ratingThresholds: true, criteria: true } });
    assert.ok(configuredPeriod.publishedAt); assert.equal(configuredPeriod.phase, "SELF_EVAL");
    assert.ok(configuredPeriod.selfEvalStart < new Date() && configuredPeriod.selfEvalDeadline > new Date());
    assert.equal(configuredPeriod.ratingThresholds.length, 4); assert.equal(configuredPeriod.criteria.length, 1);
    checks.push("realPeriodCriteriaThresholdsAndPublish");

    // Chuyển khỏi trang làm unmount bảng, quay lại phải khôi phục nháp RAM và chỉ xóa sau lưu thành công
    // Reload sau ghi phải mở lại đúng evaluationId từ URL và đọc diễn giải đã lưu từ PostgreSQL
    stage = "thẩm định direct URL và giữ nháp qua tab"; console.log(`VC16: ${stage}`);
    await admin.goto(`${origin}/admin/records?periodId=${fixture.review.periodId}&evaluationId=${fixture.review.records[0].evaluationId}`);
    await admin.getByRole("spinbutton", { name: "Điểm thẩm định A", exact: true }).fill("49");
    await admin.getByRole("textbox", { name: "Lý do thẩm định A", exact: true }).fill("Diễn giải nháp VC16");
    await admin.getByRole("menuitem", { name: /Hộp thư/u }).click();
    await admin.getByRole("menuitem", { name: /Xử lý Hồ sơ/u }).click();
    await admin.getByRole("button", { name: `Thẩm định ${await prisma.unit.findUniqueOrThrow({ where: { id: fixture.unit.unitId } }).then((row) => row.code)}`, exact: true }).click();
    assert.equal(await admin.getByRole("spinbutton", { name: "Điểm thẩm định A", exact: true }).inputValue(), "49.00");
    await admin.getByRole("button", { name: "Lưu tiêu chí A", exact: true }).click();
    await admin.getByText("Đã lưu thẩm định", { exact: true }).waitFor();
    await admin.reload(); await admin.getByRole("spinbutton", { name: "Điểm thẩm định A", exact: true }).waitFor();
    assert.equal(await admin.getByRole("textbox", { name: "Lý do thẩm định A", exact: true }).inputValue(), "Diễn giải nháp VC16");
    checks.push("adminReviewDraftSaveDirectReload");

    // Credential demo ngắn chỉ dùng cho lần đầu, thử trực tiếp API để chứng minh guard BE cũng chặn
    // Sau đổi mật khẩu mới đủ chữ và số, phiên thay thế phải mở layout UNIT mà không dùng identity từ form
    stage = "UNIT buộc đổi mật khẩu cả BE và FE"; console.log(`VC16: ${stage}`);
    await login(unit, fixture.unit.username, "123456", "change-password");
    const blocked = await unit.evaluate(async (base) => {
      const response = await fetch(`${base}/api/v1/evaluations`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("accessToken")}` } });
      return { status: response.status, body: await response.json() };
    }, fixture.base);
    assert.equal(blocked.status, 403); assert.equal(blocked.body.code, "PASSWORD_CHANGE_REQUIRED");
    await unit.getByPlaceholder("Mật khẩu hiện tại", { exact: true }).fill("123456");
    // Bảy ký tự phải bị form chặn trước HTTP, đúng tám ký tự đủ chữ và số phải được backend nhận
    // Đếm request thật và kiểm cờ DB để không suy ra đổi mật khẩu thành công chỉ từ thông báo giao diện
    let passwordRequests = 0;
    const observePassword = (request) => { if (new URL(request.url()).pathname === "/api/v1/auth/change-password" && request.method() === "POST") passwordRequests++; };
    unit.on("request", observePassword);
    await unit.getByPlaceholder("Mật khẩu mới", { exact: true }).fill("Chu1234");
    await unit.getByPlaceholder("Xác nhận mật khẩu mới", { exact: true }).fill("Chu1234");
    await unit.getByRole("button", { name: "Xác nhận đổi", exact: true }).click();
    await unit.getByText("Mật khẩu mới phải có ít nhất 8 ký tự.", { exact: true }).waitFor();
    assert.equal(passwordRequests, 0);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: fixture.unit.userId } })).mustChangePassword, true);
    await unit.getByPlaceholder("Mật khẩu mới", { exact: true }).fill("Chu12345");
    await unit.getByPlaceholder("Xác nhận mật khẩu mới", { exact: true }).fill("Chu12345");
    await unit.getByRole("button", { name: "Xác nhận đổi", exact: true }).click();
    await unit.waitForURL("**/unit/dashboard");
    unit.off("request", observePassword); assert.equal(passwordRequests, 1);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: fixture.unit.userId } })).mustChangePassword, false);
    checks.push("realPasswordSevenRejectedEightAccepted"); checks.push("forcedPasswordBackendAndFrontend");
    await unit.getByRole("menuitem", { name: /Hồ sơ tự chấm/u }).click();

    // Đổi Date.now của browser không được lộ tiêu chí, chỉ điều kiện mở ở DB thử mới thay quyền khi refetch
    // Không sửa đồng hồ hệ thống hoặc dùng đồng hồ client làm nguồn cấp quyền
    stage = "chờ mở không lộ tiêu chí dù đổi giờ client"; console.log(`VC16: ${stage}`);
    await selectUnitPeriod("Kỳ chờ mở VC16");
    await unit.getByText("Kỳ đánh giá chưa đến giờ mở tiêu chí", { exact: true }).waitFor();
    const hiddenText = "Kỳ chờ mở VC16 — Nội dung tiêu chí";
    assert.equal(await unit.getByText(hiddenText, { exact: true }).count(), 0);
    // Lưu hàm gốc để phép thử lệch giờ không vô tình biến các bước mạng phía sau thành thử JWT hết hạn
    // Khôi phục ngay sau khi backend đã chứng minh vẫn giấu tiêu chí dù đồng hồ client vượt xa thời điểm mở
    await unit.evaluate(() => { Date.vc17OriginalNow = Date.now; Date.now = () => 2100000000000; });
    const [hiddenResponse] = await Promise.all([
      unit.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/evaluations/${fixture.waiting.evaluationId}` && response.status() === 200),
      unit.getByRole("button", { name: "Làm mới", exact: true }).click(),
    ]);
    assert.equal((await hiddenResponse.json()).criteriaVisible, false);
    await unit.getByText("Kỳ đánh giá chưa đến giờ mở tiêu chí", { exact: true }).waitFor();
    assert.equal(await unit.getByText(hiddenText, { exact: true }).count(), 0);
    await unit.evaluate(() => { Date.now = Date.vc17OriginalNow; delete Date.vc17OriginalNow; });
    await prisma.evaluationPeriod.update({ where: { id: fixture.waiting.periodId }, data: { selfEvalStart: new Date(Date.now() - 1000) } });
    await unit.evaluate(() => window.dispatchEvent(new Event("focus")));
    await unit.getByText(hiddenText, { exact: true }).waitFor();
    checks.push("serverTimeVisibilityAndClientClockSkew");

    // Mất kết nối phải giữ nháp và câu lỗi tiếng Việt, chậm mạng chỉ trì hoãn rồi chuyển tiếp request thật
    // Bài kiểm không fulfill response giả và không coi nút lưu được bấm là đã commit dữ liệu
    stage = "UNIT giữ nháp, mạng chậm và lỗi mất kết nối"; console.log(`VC16: ${stage}`);
    await selectUnitPeriod("Kỳ đang tự chấm VC16");
    const card = unit.locator(".ant-card").filter({ has: unit.getByText("Kỳ đang tự chấm VC16 — Nội dung tiêu chí", { exact: true }) });
    await card.getByRole("spinbutton", { name: "Điểm VC16", exact: true }).fill("80");
    await card.getByRole("textbox", { name: "Diễn giải VC16", exact: true }).fill("Nội dung <script>không chạy</script> VC16");
    await unit.getByRole("menuitem", { name: /Hộp thư thông báo/u }).click();
    await unit.waitForURL("**/unit/notifications");
    // Đợi lần tải thật sau khi điều hướng, tránh đọc thẻ cũ còn trên DOM rồi ngắt mạng khi trang mới chưa có dữ liệu
    await unit.getByRole("menuitem", { name: /Hồ sơ tự chấm/u }).click();
    await selectUnitPeriod("Kỳ đang tự chấm VC16");
    await unit.getByRole("button", { name: "Làm mới", exact: true }).locator(".anticon-loading").waitFor({ state: "hidden" });
    assert.equal(await card.getByRole("spinbutton", { name: "Điểm VC16", exact: true }).inputValue(), "80.00");
    // Chỉ gây đứt mạng cho request lưu để polling đọc quyền vẫn hoạt động độc lập
    // Không tạo response giả và không gửi request tới BE, nháp phải còn nguyên còn DB chưa được ghi thành công
    await unitContext.route("**/api/v1/evaluations/*/scores/self-batch", (route) => route.abort("internetdisconnected"));
    await card.getByRole("button", { name: "Lưu tiêu chí VC16", exact: true }).click();
    await card.getByText("Không thể kết nối máy chủ. Vui lòng thử lại.", { exact: true }).waitFor();
    assert.equal(await card.getByRole("spinbutton", { name: "Điểm VC16", exact: true }).inputValue(), "80.00");
    await unitContext.unrouteAll({ behavior: "wait" });
    await unit.getByRole("button", { name: "Làm mới", exact: true }).click();
    await card.getByRole("button", { name: "Lưu tiêu chí VC16", exact: true }).waitFor();
    await unitContext.route("**/api/v1/evaluations/*/scores/self-batch", async (route) => { await new Promise((resolve) => setTimeout(resolve, 1000)); await route.continue(); });
    await card.getByRole("button", { name: "Lưu tiêu chí VC16", exact: true }).click();
    await card.getByText("Đã lưu điểm và diễn giải", { exact: true }).waitFor();
    await unitContext.unrouteAll({ behavior: "wait" });
    checks.push("unitDraftNavigationOfflineSlowRealSave");

    stage = "upload PDF thật và preview bằng bàn phím"; console.log(`VC16: ${stage}`);
    // Sinh PDF một trang có bytes thật để viewer Chrome có nội dung hiển thị sau upload
    // Chỉ font mặc định và văn bản thử, không tải tài nguyên ngoài hoặc dùng file của người thật
    const pdf = await new Promise((resolve, reject) => {
      const document = new PDFDocument(); const chunks = [];
      document.on("data", (chunk) => chunks.push(chunk)); document.on("end", () => resolve(Buffer.concat(chunks)));
      document.on("error", () => reject(new Error("Không thể tạo PDF kiểm thử")));
      document.text("Minh chung VC16 - backend va kho local that"); document.end();
    });
    await card.locator('input[type="file"]').setInputFiles({ name: "Minh chứng VC16.pdf", mimeType: "application/pdf", buffer: pdf });
    await card.getByText("Minh chứng VC16.pdf: Đã gắn minh chứng", { exact: true }).waitFor();
    await card.getByRole("button", { name: "Xem trước", exact: true }).focus(); await unit.keyboard.press("Enter");
    await unit.getByRole("dialog", { name: "Minh chứng VC16.pdf", exact: true }).waitFor();
    assert.match(await unit.locator('iframe[title="Xem trước PDF minh chứng"]').getAttribute("src"), /^blob:/);
    await unit.keyboard.press("Escape"); checks.push("realPdfUploadPreviewKeyboard");

    // Backend từ chối HTML trong phản hồi, frontend phải giữ nháp để sửa và gửi lại văn bản thuần
    // Minh chứng React không thực thi HTML được kiểm riêng bằng diễn giải tự chấm đã lưu phía trên
    stage = "trao đổi và lịch sử qua backend thật"; console.log(`VC16: ${stage}`);
    await card.getByRole("textbox", { name: "Nội dung phản hồi", exact: true }).fill("Phản hồi VC16 <script>không chạy</script>");
    await card.getByRole("button", { name: "Gửi phản hồi", exact: true }).click();
    await card.getByText(/Dữ liệu gửi lên không hợp lệ/u).waitFor();
    assert.equal(await card.getByRole("textbox", { name: "Nội dung phản hồi", exact: true }).inputValue(), "Phản hồi VC16 <script>không chạy</script>");
    await card.getByRole("textbox", { name: "Nội dung phản hồi", exact: true }).fill("Phản hồi văn bản thuần VC16");
    await card.getByRole("button", { name: "Gửi phản hồi", exact: true }).click();
    await card.getByText("Đã gửi phản hồi", { exact: true }).waitFor();
    await card.getByText("Phản hồi văn bản thuần VC16", { exact: true }).waitFor();
    checks.push("realFeedbackPlainTextAndHistory");

    // Dùng hồ sơ khác cho nộp sớm để vẫn giữ một DRAFT riêng cho phép thử đua deadline phía sau
    // Xác nhận popup và trạng thái DB chứng minh frontend đã nối lệnh nộp thay vì tự khóa cục bộ
    stage = "nộp hồ sơ tự chấm bằng UI"; console.log(`VC16: ${stage}`);
    await selectUnitPeriod("Kỳ chờ mở VC16");
    const waitingCard = unit.locator(".ant-card").filter({ has: unit.getByText(hiddenText, { exact: true }) });
    await waitingCard.getByRole("spinbutton", { name: "Điểm VC16", exact: true }).fill("50");
    await waitingCard.getByRole("button", { name: "Lưu tiêu chí VC16", exact: true }).click();
    await waitingCard.getByText("Đã lưu điểm và diễn giải", { exact: true }).waitFor();
    await waitingCard.getByRole("button", { name: "Nộp hồ sơ", exact: true }).click();
    await unit.locator(".ant-popconfirm:visible").getByRole("button", { name: "Nộp hồ sơ", exact: true }).click();
    await waitingCard.getByText("Đã nộp hồ sơ, nội dung tự chấm đã khóa chỉnh sửa", { exact: true }).waitFor();
    assert.equal((await prisma.evaluation.findUniqueOrThrow({ where: { id: fixture.waiting.evaluationId } })).status, "PENDING_REVIEW");
    checks.push("realInitialSubmit");

    /** Các lệnh thẩm định có xác nhận phải thật sự chờ nút trong modal trước khi gửi API
     * Dùng đúng hộp thoại đang hiển thị để không bấm nhầm nút cùng tên phía sau
     */
    async function confirmReview(button) {
      await admin.getByRole("button", { name: button, exact: true }).click();
      await admin.getByRole("dialog").getByRole("button", { name: "Xác nhận", exact: true }).click();
    }
    // Cả lượt đầu, preview thứ Sáu, gửi yêu cầu, nộp lại và chốt đều qua UI có xác nhận
    // Chỉ mốc chờ của fixture được rút ngắn, baseline và mọi trạng thái vẫn do nghiệp vụ thật ghi
    stage = "thẩm định yêu cầu bổ sung theo lịch và xác nhận"; console.log(`VC16: ${stage}`);
    await confirmReview("Chấp nhận các ô chưa duyệt");
    await admin.getByText("Đã chấp nhận các ô chưa duyệt", { exact: true }).waitFor();
    await confirmReview("Hoàn tất thẩm định lần đầu");
    await admin.getByText("Đã hoàn tất thẩm định lần đầu", { exact: true }).waitFor();
    const friday = new Date(Date.now() + 7 * 86400000 + 7 * 3600000);
    while (friday.getUTCDay() !== 6) friday.setUTCDate(friday.getUTCDate() + 1);
    const formattedStart = `${String(friday.getUTCDate()).padStart(2, "0")}/${String(friday.getUTCMonth() + 1).padStart(2, "0")}/${friday.getUTCFullYear()} 23:00`;
    await admin.getByLabel("Ngày giờ mở bổ sung theo giờ Việt Nam", { exact: true }).fill(formattedStart);
    await admin.getByLabel("Ngày giờ mở bổ sung theo giờ Việt Nam", { exact: true }).press("Enter");
    const formattedEnd = formattedStart.replace("23:00", "23:45");
    await admin.getByLabel("Ngày giờ kết thúc bổ sung", { exact: true }).fill(formattedEnd);
    await admin.getByLabel("Ngày giờ kết thúc bổ sung", { exact: true }).press("Enter");
    await admin.getByRole("checkbox", { name: "Chọn bổ sung A", exact: true }).check();
    await admin.getByRole("textbox", { name: "Yêu cầu bổ sung A", exact: true }).fill("Bổ sung diễn giải tiêu chí A qua kiểm VC16");
    const [scheduleResponse] = await Promise.all([admin.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/supplement-schedule/preview")), admin.getByRole("button", { name: "Xem trước lịch bổ sung", exact: true }).click()]);
    assert.equal(scheduleResponse.status(), 200);
    const schedule = await scheduleResponse.json();
    assert.equal(Date.parse(schedule.supplementDeadline) - Date.parse(schedule.supplementStartAt), 45 * 60000);
    await confirmReview("Gửi yêu cầu bổ sung");
    await admin.getByText("Đã gửi yêu cầu bổ sung theo lịch đã chọn", { exact: true }).waitFor();
    // Chuyển điều kiện trước về cửa sổ đang mở trong DB test, không đổi đồng hồ hoặc tính hạn bằng supplementHours
    // Request và baseline vẫn do nghiệp vụ thật tạo, chỉ rút ngắn thời gian chờ của bài browser
    await prisma.evaluation.update({ where: { id: fixture.unit.evaluationId }, data: { supplementStartAt: new Date(Date.now() - 60000), supplementDeadline: new Date(Date.now() + 1800000) } });
    await selectUnitPeriod("Kỳ thẩm định VC16");
    await unit.evaluate(() => window.dispatchEvent(new Event("focus")));
    const reviewCard = unit.locator(".ant-card").filter({ has: unit.getByText("Tiêu chí A", { exact: true }) });
    await reviewCard.getByRole("textbox", { name: "Diễn giải A", exact: true }).fill("Diễn giải đã bổ sung VC16");
    assert.equal(await reviewCard.getByRole("spinbutton", { name: "Điểm B", exact: true }).isDisabled(), true);
    await reviewCard.getByRole("button", { name: "Lưu tiêu chí A", exact: true }).click();
    await reviewCard.getByText("Đã lưu điểm và diễn giải", { exact: true }).waitFor();
    await reviewCard.getByRole("button", { name: "Nộp bổ sung", exact: true }).click();
    await unit.locator(".ant-popconfirm:visible").getByRole("button", { name: "Nộp hồ sơ", exact: true }).click();
    await reviewCard.getByText("Đã nộp nội dung bổ sung và khóa chỉnh sửa", { exact: true }).waitFor();
    await admin.evaluate(() => window.dispatchEvent(new Event("focus")));
    await admin.getByRole("spinbutton", { name: "Điểm thẩm định A", exact: true }).fill("49");
    await admin.getByRole("textbox", { name: "Lý do thẩm định A", exact: true }).fill("Đã kiểm lại nội dung bổ sung VC16");
    await admin.getByRole("button", { name: "Lưu tiêu chí A", exact: true }).click();
    await admin.getByText("Đã lưu thẩm định", { exact: true }).waitFor();
    // Hồ sơ khác chỉ là điều kiện trước của kỳ, hoàn tất bằng API thật để kiểm UI chuyển phase và chốt hồ sơ chính
    const otherId = fixture.review.records[1].evaluationId;
    assert.equal((await adminRequest("POST", `admin/evaluations/${otherId}/accept-all`, {})).status, 200);
    assert.equal((await adminRequest("POST", `admin/evaluations/${otherId}/first-review-complete`, {})).status, 200);
    // Chờ quyền chuyển phase tải lại từ HTTP thật, không chọn option theo snapshot trước lệnh API vừa thực hiện
    const [phaseRefresh] = await Promise.all([admin.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/phase-options") && response.request().method() === "GET"), admin.getByRole("button", { name: "Làm mới", exact: true }).click()]);
    assert.equal(phaseRefresh.status(), 200);
    await admin.getByRole("combobox", { name: "Giai đoạn muốn chuyển", exact: true }).click();
    await admin.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: "Thẩm định cuối" }).click();
    await admin.getByRole("button", { name: "Chuyển giai đoạn", exact: true }).click();
    await admin.locator(".ant-popconfirm:visible").getByRole("button", { name: "Chuyển giai đoạn", exact: true }).click();
    await admin.getByRole("button", { name: "Xem trước và chốt hồ sơ", exact: true }).click();
    await admin.getByRole("dialog").getByRole("button", { name: /Xác nhận chốt/u }).click();
    await admin.getByText("Đã chốt thành công", { exact: true }).waitFor();
    await admin.getByText("Đã chốt: 84 điểm · 84% · Tốt", { exact: true }).waitFor();
    await unit.evaluate(() => window.dispatchEvent(new Event("focus")));
    await reviewCard.getByText(/Kết quả đã chốt: 84 điểm/u).waitFor();
    const finalized = await prisma.evaluation.findUniqueOrThrow({ where: { id: fixture.unit.evaluationId } });
    assert.equal(finalized.status, "FINALIZED"); assert.equal(finalized.finalScore.toNumber(), 84);
    checks.push("realReviewSupplementSubmitFinalizeAndOfficialResult");

    // Màn hình hẹp vẫn phải cuộn bảng trong trang, direct URL không được vượt guard theo vai trò
    stage = "403 404 responsive và UNIT không có menu ADMIN"; console.log(`VC16: ${stage}`);
    // Modal có cả nút X và nút chân trang cùng nhãn Việt, chọn chân trang để không bị trùng tên truy cập
    await admin.locator(".ant-modal:visible .ant-modal-footer").getByRole("button", { name: "Đóng", exact: true }).click();
    stage = "màu tiêu đề bảng và tag xếp loại theo kỳ"; console.log(`VC16: ${stage}`);
    const [rankingResponse] = await Promise.all([
      admin.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/leaderboard") && response.request().method() === "GET"),
      admin.goto(`${origin}/admin/dashboard?periodId=${fixture.review.periodId}`),
    ]);
    assert.equal(rankingResponse.status(), 200);
    const rankingPayload = await rankingResponse.json();
    const ranked = (rankingPayload.data ?? rankingPayload).items.find((item) => item.evaluationId === fixture.unit.evaluationId);
    assert.ok(ranked?.ratingLabel && /^#[0-9a-f]{6}$/i.test(ranked.ratingColor));
    const ratingTag = admin.locator(`tr[data-row-key="${ranked.evaluationId}"]`).getByText(ranked.ratingLabel, { exact: true });
    await ratingTag.waitFor();
    const expectedBackground = `rgb(${[1, 3, 5].map((offset) => parseInt(ranked.ratingColor.slice(offset, offset + 2), 16)).join(", ")})`;
    assert.equal(await ratingTag.evaluate((node) => window.getComputedStyle(node).backgroundColor), expectedBackground);
    assert.equal(await admin.locator(".ant-table-thead th").first().evaluate((node) => window.getComputedStyle(node).backgroundColor), "rgb(228, 233, 238)");
    const distributionTag = admin.locator(".ant-card").filter({ has: admin.getByText("Xếp loại chính thức", { exact: true }) }).getByText(ranked.ratingLabel, { exact: true });
    assert.equal(await distributionTag.evaluate((node) => window.getComputedStyle(node).backgroundColor), expectedBackground);
    await admin.screenshot({ path: ".tmp/vc16-artifacts/admin-style-guide-desktop.png", fullPage: true });
    checks.push("styleGuideTableHeaderAndConfiguredRatingColors");
    stage = "403 404 responsive và UNIT không có menu ADMIN";
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.goto(`${origin}/admin/reports?periodId=${fixture.review.periodId}`);
    await admin.getByRole("combobox", { name: "Loại báo cáo", exact: true }).click();
    await admin.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: "Biên bản thẩm định (PDF/Word)" }).click();
    const selectorBox = await admin.getByRole("combobox", { name: "Hồ sơ đơn vị", exact: true }).boundingBox();
    assert.ok(selectorBox && selectorBox.x + selectorBox.width <= 390);
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await admin.screenshot({ path: ".tmp/vc16-artifacts/admin-mobile.png", fullPage: true });
    await unit.setViewportSize({ width: 390, height: 844 });
    assert.equal(await unit.getByRole("menuitem", { name: /Quản lý Tài khoản/u }).count(), 0);
    assert.ok(await unit.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await unit.screenshot({ path: ".tmp/vc16-artifacts/unit-mobile.png", fullPage: true });
    await unit.goto(`${origin}/admin/users`); await unit.getByText("Bạn không có quyền truy cập trang này", { exact: true }).waitFor();
    await unit.goto(`${origin}/duong-dan-khong-co-vc16`); await unit.getByText("Không tìm thấy trang được yêu cầu", { exact: true }).waitFor();
    checks.push("responsiveRoleGuardAnd404");

    // Giữ request sau khi người dùng bấm lưu, đẩy deadline DB tới quá hạn rồi mới cho request đến Nest
    // Điểm đã commit trước đó phải giữ nguyên dù UI đã nhìn thấy quyền sửa trong snapshot cũ
    stage = "hết hạn trong lúc lưu khóa server và giữ nháp"; console.log(`VC16: ${stage}`);
    await unit.goto(`${origin}/unit/records`);
    await selectUnitPeriod("Kỳ đang tự chấm VC16");
    await card.getByRole("spinbutton", { name: "Điểm VC16", exact: true }).fill("81");
    await unitContext.route("**/api/v1/evaluations/*/scores/self-batch", async (route) => {
      await prisma.evaluationPeriod.update({ where: { id: fixture.open.periodId }, data: { selfEvalDeadline: new Date(Date.now() - 1) } });
      await route.continue();
    });
    // Chờ đúng phản hồi ghi bị từ chối, không dùng nhãn countdown có sẵn làm bằng chứng deadline
    // Batch có thể trả lỗi từng mục trong HTTP 200, mã quyền phải được kiểm ở payload thực tế
    const [expiredSave] = await Promise.all([unit.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/scores/self-batch") && response.request().method() !== "OPTIONS"), card.getByRole("button", { name: "Lưu tiêu chí VC16", exact: true }).click()]);
    const expiredBody = await expiredSave.json();
    const denied = expiredBody.results?.find((item) => !item.ok)?.error ?? expiredBody;
    assert.equal(denied.code, "SELF_EVALUATION_LOCKED");
    await card.getByText(denied.message, { exact: true }).first().waitFor();
    assert.equal(await card.getByRole("spinbutton", { name: "Điểm VC16", exact: true }).inputValue(), "81.00");
    assert.equal((await prisma.criterionScore.findUniqueOrThrow({ where: { evaluationId_criterionId: { evaluationId: fixture.open.evaluationId, criterionId: fixture.open.criterionId } } })).selfScore.toNumber(), 80);
    await unitContext.unrouteAll({ behavior: "wait" });
    checks.push("deadlineRaceKeepsDatabaseAndDraft");

    // Khóa đúng user fixture qua API ADMIN để access và refresh cũ đều bị server từ chối
    // Giao diện phải xóa phiên và báo hết hạn, không tiếp tục hiển thị quyền từ cache
    stage = "tài khoản bị khóa làm phiên mất hiệu lực"; console.log(`VC16: ${stage}`);
    assert.equal((await adminRequest("PATCH", `users/${fixture.unit.userId}/status`, { isActive: false })).status, 200);
    await unit.evaluate(() => window.dispatchEvent(new Event("focus")));
    await unit.waitForURL("**/login");
    await unit.getByText("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", { exact: true }).waitFor();
    checks.push("lockedAccountSessionExpiry");
    await writeFile(".tmp/vc16-artifacts/browser-results.json", JSON.stringify({ checks, mockBackend: false }, null, 2));
    console.log(JSON.stringify({ checks, mockBackend: false }));
  } catch (error) {
    await admin.screenshot({ path: ".tmp/vc16-artifacts/admin-failure.png", fullPage: true }).catch(() => undefined);
    await unit.screenshot({ path: ".tmp/vc16-artifacts/unit-failure.png", fullPage: true }).catch(() => undefined);
    const session = await admin.evaluate(() => ({ hasAccess: Boolean(sessionStorage.getItem("accessToken")), hasRefresh: Boolean(sessionStorage.getItem("refreshToken")), path: location.pathname })).catch(() => null);
    // Chỉ giữ nhãn locator đang chờ khi timeout, bỏ DOM và đối tượng lỗi có thể chứa credential hoặc URL ký
    const waitingFor = error.name === "TimeoutError" ? error.log?.find((line) => line.includes("waiting for"))?.slice(0, 240) : undefined;
    // Lỗi trùng selector chỉ giữ dòng mô tả locator do bài kiểm kiểm soát, không giữ DOM hoặc stack
    const locatorHint = /strict mode violation/.test(error.message) ? error.message.split("\n")[0].slice(0, 240) : undefined;
    // Chỉ lưu nhãn chẩn đoán cố định, không sao chép DOM hoặc nội dung thao tác có thể chứa credential
    const interactionHints = ["element is not visible", "element is not enabled", "element is not stable", "intercepts pointer events", "element was detached", "element is outside of the viewport"].filter((hint) => error.log?.some((line) => line.includes(hint)));
    await writeFile(".tmp/vc16-artifacts/browser-results.json", JSON.stringify({ checks, failedStage: stage, failureKind: error.name, waitingFor, locatorHint, interactionHints, authResponses, failedRequests, session, mockBackend: false }, null, 2));
    throw error;
  } finally { await prisma.$disconnect(); await adminContext.close(); await unitContext.close(); await browser.close(); }
}

/** Chỉ in giai đoạn cố định khi lỗi để không phản chiếu credential hay nội dung request */
verify().catch(() => { console.error(`Kiểm Chrome VC16 chưa đạt tại bước ${stage}`); process.exitCode = 1; });
