import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { URL, pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";
import { readReportExcel, readReportPdf, readReportWord } from "../integration/vc15-files.js";

let stage = "khởi tạo";

/** Kiểm Chrome thật tạo/tải đủ ba định dạng qua FE/Nest/PG riêng, không mock hoặc chặn mạng API
 * Chỉ dùng credential fixture và hai origin loopback, tải file rồi đọc parser để chứng minh bytes thật
 * Module Playwright nằm ngoài dependency ứng dụng, script chạy với node --import tsx
 */
async function verifyBrowser() {
  const fixture = JSON.parse(await readFile(".tmp/vc15-browser-state.json", "utf8"));
  const origin = process.env.VC15_FE_ORIGIN ?? "http://127.0.0.1:5185";
  if (![origin, fixture.base].every((url) => new URL(url).hostname === "127.0.0.1") || !/^vc12-admin-[0-9a-f]{8}$/.test(fixture.username)) throw new Error("Cần fixture local riêng cho kiểm VC15");
  const modulePath = process.env.VC15_PLAYWRIGHT_MODULE;
  if (!modulePath) throw new Error("Cần chỉ định module Playwright kiểm thử VC15");
  const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
  const browser = await chromium.launch({ executablePath: process.env.VC15_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1680, height: 1100 } });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  await mkdir(".tmp/vc15-artifacts", { recursive: true });
  try {
    stage = "đăng nhập";
    await page.goto(`${origin}/login`);
    await page.getByPlaceholder("Tên đăng nhập (vd: coso01)").fill(fixture.username);
    await page.getByPlaceholder("Mật khẩu (vd: coso123)").fill(fixture.password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL("**/admin/dashboard");
    stage = "mở báo cáo theo kỳ";
    await page.getByRole("menuitem", { name: /Báo cáo/u }).click();
    stage = "chọn kỳ từ URL";
    await page.goto(`${origin}/admin/reports?periodId=${fixture.periodId}`);
    await page.getByText("Kỳ kiểm chứng báo cáo VC15", { exact: false }).waitFor();

    /** Tạo qua nút UI rồi tải đúng dòng mới, lưu tệp bằng download event của Chrome
     * Các assertion đọc bytes bên dưới không lấy dữ liệu từ state hoặc generator
     */
    async function createAndDownload(format) {
      const [response] = await Promise.all([
        page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/admin/reports/exports"),
        page.getByRole("button", { name: "Tạo báo cáo", exact: true }).click(),
      ]);
      assert.equal(response.status(), 201);
      const raw = await response.json(); const metadata = raw.data ?? raw;
      if (format !== "XLSX") assert.equal(metadata.evaluationId, fixture.evaluationId);
      await page.getByText(/Đã tạo báo cáo/u).waitFor();
      const row = page.locator(`tr[data-row-key="${metadata.id}"]`);
      await row.waitFor();
      const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: `Tải ${format}`, exact: true }).click()]);
      assert.equal(await download.failure(), null);
      const bytes = await readFile(await download.path());
      await writeFile(`.tmp/vc15-artifacts/browser-${format.toLowerCase()}.${format.toLowerCase()}`, bytes);
      return bytes;
    }
    stage = "tạo và tải Excel";
    const excel = await readReportExcel(await createAndDownload("XLSX"));
    assert.equal(excel.getWorksheet("Tổng hợp").getCell("E10").value, 170);
    stage = "chọn biên bản PDF";
    await page.getByRole("combobox", { name: "Loại báo cáo", exact: true }).click();
    // Select ảo hóa có option ARIA ngoài màn hình, chọn nhãn trong popup đang hiển thị để bấm đúng phần tử
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: "Biên bản thẩm định (PDF/Word)" }).click();
    stage = "chọn đơn vị cho biên bản";
    await page.getByRole("combobox", { name: "Hồ sơ đơn vị", exact: true }).click();
    stage = "chọn nhãn đơn vị trong popup";
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: "Đơn vị báo cáo tiếng Việt số một — Chờ duyệt" }).click();
    stage = "tạo và tải PDF";
    const pdf = await readReportPdf(await createAndDownload("PDF"));
    assert.ok(pdf.text.includes("CHƯA CHỐT") && pdf.text.includes("Đơn vị báo cáo tiếng Việt số một"));
    stage = "chọn Word";
    await page.getByRole("combobox", { name: "Định dạng", exact: true }).click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: "Word" }).click();
    const xml = await readReportWord(await createAndDownload("DOCX"));
    assert.ok(xml.includes("Đơn vị báo cáo tiếng Việt số một") && xml.includes("CHƯA CHỐT"));
    stage = "tải lại lịch sử từ DB";
    await page.reload();
    await page.getByRole("button", { name: "Tải XLSX", exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Tải PDF", exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Tải DOCX", exact: true }).first().waitFor();
    await page.screenshot({ path: ".tmp/vc15-artifacts/browser-three-formats.png", fullPage: true });
    stage = "đổi kỳ kiểm phạm vi";
    await page.getByRole("combobox", { name: "Kỳ đánh giá", exact: true }).click();
    // Các lượt fixture không xóa DB nên có thể trùng nhãn, chọn kỳ khác mới nhất trong danh sách đã sắp
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: "Kỳ khác kiểm phạm vi VC15" }).first().click();
    await page.getByText("Chưa có báo cáo phù hợp", { exact: true }).waitFor();
    await page.screenshot({ path: ".tmp/vc15-artifacts/browser-empty-other-period.png", fullPage: true });
    console.log(JSON.stringify({ xlsxReadBack: true, pdfVietnameseReadBack: true, wordXmlReadBack: true, reloadFromBackend: true, periodScope: true, mockApi: false }));
  } catch (error) {
    // Ảnh chẩn đoán chỉ ở thư mục tạm, không in DOM hoặc URL ký khi locator chưa tìm thấy phần tử
    await page.screenshot({ path: ".tmp/vc15-artifacts/browser-failure.png", fullPage: true }).catch(() => undefined);
    throw error;
  } finally { await context.close(); await browser.close(); }
}

/** Chỉ in nhãn bước cố định nếu lỗi, tránh Playwright dump token hoặc credential fixture */
verifyBrowser().catch(() => { console.error(`Kiểm Chrome VC15 chưa đạt tại bước ${stage}`); process.exitCode = 1; });
