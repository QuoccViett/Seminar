import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";

let stage = "khởi tạo trình duyệt";

/** Kiểm trình duyệt Chrome thật với FE/Nest/PG thử riêng, không mock API hoặc provider local
 * Module Playwright được cung cấp ngoài dependency ứng dụng để không đổi stack hoặc tải browser trong CI
 * Chỉ chạy trên hai cổng loopback VC10, fixture do integration tạo và không chứa mật khẩu người thật
 */
async function verifyBrowser() {
  const modulePath = process.env.VC10_PLAYWRIGHT_MODULE;
  const fixturePath = process.env.VC10_BROWSER_FIXTURE_FILE;
  if (!modulePath || !fixturePath) throw new Error("Cần chỉ định module Playwright và file fixture thử nghiệm VC10");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  if (!/^vc10-unit-[a-f0-9]{8}$/.test(fixture.username)) throw new Error("Fixture không thuộc tài khoản kiểm thử VC10");
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const browser = await chromium.launch({ executablePath: process.env.VC10_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  try {
    stage = "đăng nhập tài khoản thử nghiệm";
    await page.goto("http://127.0.0.1:5180/login");
    await page.getByRole("textbox", { name: /Tên đăng nhập/u }).fill(fixture.username);
    await page.getByRole("textbox", { name: /Mật khẩu/u }).fill("Vc10Test2026x");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL("**/unit/records");
    stage = "chọn và xác nhận ba tệp";
    const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "MC1", exact: true }) });
    // Đợi snapshot lá tải xong trước đếm fixture, count trên locator chưa render sẽ trả 0 và bỏ qua dọn quota
    await row.waitFor();
    const names = ["Kiểm browser PDF.pdf", "Kiểm browser PNG.png", "Kiểm browser Word.docx"];
    const mimeTypes = ["application/pdf", "image/png", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    const buffers = await Promise.all(fixture.files.map((path) => readFile(path)));
    /** Tìm nhóm nút ngang gần tên tệp nhất, không nhầm wrapper riêng của Typography trong Ant Space */
    const controls = (name) => row.getByText(name, { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"ant-space-horizontal")][1]');
    // Dọn đúng các tên fixture của bài browser bằng API UI thật để lần chạy lại không vượt quota
    // Không xóa file khác của hồ sơ, số phần tử giảm là bằng chứng snapshot đã cập nhật sau DELETE
    stage = "dọn fixture browser của lần chạy trước";
    for (const name of names) {
      let count = await row.getByText(name, { exact: true }).count();
      while (count > 0) {
        await controls(name).getByRole("button", { name: "Xóa", exact: true }).click();
        await page.getByRole("tooltip").getByRole("button", { name: "Xóa", exact: true }).click();
        await row.getByText(name, { exact: true }).nth(count - 1).waitFor({ state: "detached" });
        count = await row.getByText(name, { exact: true }).count();
      }
    }
    stage = "chọn và xác nhận ba tệp";
    // Chọn ba tệp thật cùng lúc, mỗi tệp chỉ được coi là xong khi server đã xác nhận Evidence
    await row.locator('input[type="file"]').setInputFiles(buffers.map((buffer, index) => ({ name: names[index], mimeType: mimeTypes[index], buffer })));
    for (const name of names) await row.getByText(`${name}: Đã gắn minh chứng`, { exact: true }).waitFor();

    stage = "xem trước PDF";
    await controls(names[0]).getByRole("button", { name: "Xem trước", exact: true }).click();
    await page.getByRole("dialog", { name: names[0], exact: true }).waitFor();
    assert.match(await page.locator('iframe[title="Xem trước PDF minh chứng"]').getAttribute("src"), /^blob:/);
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    stage = "giải mã ảnh PNG";
    await controls(names[1]).getByRole("button", { name: "Xem trước", exact: true }).click();
    await page.getByRole("dialog", { name: names[1], exact: true }).waitFor();
    await page.getByAltText("Minh chứng", { exact: true }).evaluate((image) => image.decode());
    assert.ok(await page.getByAltText("Minh chứng", { exact: true }).evaluate((image) => image.naturalWidth > 0));
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    stage = "tải Word và đối chiếu bytes";
    // acceptDownloads của Chrome độc lập cho phép kiểm bytes tải thật thay vì suy từ nút hoặc HTTP 200
    const [download] = await Promise.all([page.waitForEvent("download"), controls(names[2]).getByRole("button", { name: "Tải xuống", exact: true }).click()]);
    assert.equal(download.suggestedFilename(), names[2]);
    assert.equal(await download.failure(), null);
    assert.deepEqual(await readFile(await download.path()), buffers[2]);
    stage = "xóa minh chứng qua giao diện";

    // Xóa một tệp qua popup thật rồi đợi snapshot mất metadata, không xóa trực tiếp object trong test browser
    await controls(names[0]).getByRole("button", { name: "Xóa", exact: true }).click();
    await page.getByRole("tooltip").getByRole("button", { name: "Xóa", exact: true }).click();
    await row.getByText(names[0], { exact: true }).waitFor({ state: "detached" });
    stage = "tải lại metadata từ backend";
    // Hủy DOM hoàn toàn và reload để xác nhận file còn lại được đọc từ backend, không phải state của component
    await page.reload();
    await row.getByText(names[2], { exact: true }).waitFor();
    console.log(JSON.stringify({ uploadCount: 3, pdfPreview: true, pngDecoded: true, wordDownloadedBytesMatch: true, deleteViaUi: true, reloadMetadata: true }));
  } finally { await context.close(); await browser.close(); }
}

/** Chỉ in câu tiếng Việt cố định khi hỏng, không để Playwright dump DOM có credential hoặc URL ký */
verifyBrowser().catch(() => { console.error(`Kiểm trình duyệt VC10 chưa đạt tại bước ${stage}`); process.exitCode = 1; });
