import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { validate } from "class-validator";
import { ExportsService } from "./exports.service.js";
import { ReportStorageService } from "./report-storage.service.js";
import { CreateReportExportDto } from "./dto/create-report-export.dto.js";

/** Dựng service với snapshot giả tối thiểu và kho local thật để kiểm nhánh lỗi độc lập
 * Mặc định transaction ném lỗi, kiểm tích hợp PostgreSQL riêng sẽ chứng minh ghi metadata/audit nguyên tử
 */
function fixture(root: string) {
  let writes = 0;
  const periodId = randomUUID();
  const prisma = { $transaction: async () => { writes += 1; throw new Error("Lỗi nội bộ giả lập"); } };
  const config = new ConfigService({ REPORT_EXPORT_DIR: root });
  const generator = { generateSummary: async () => ({ buffer: Buffer.from("báo cáo"), extension: "xlsx", contentType: "application/octet-stream" }) };
  const snapshot = { read: async () => ({ type: "summary", data: { period: { year: 2026, generatedAt: new Date() } } }) };
  const storage = new ReportStorageService(config);
  const service = new ExportsService({} as never, prisma as never, config, generator as never, {} as never, {} as never, snapshot as never, storage, new JwtService({ secret: "unit-test-only-at-least-32-characters" }));
  return { service, storage, periodId, getWrites: () => writes };
}

/** Các cặp định dạng sai và scope thiếu phải bị chặn trước truy vấn snapshot và ghi metadata
 * Số mã kỹ thuật không đổi, thông báo luôn là tiếng Việt có dấu
 */
test("từ chối định dạng và scope không phù hợp với loại báo cáo", async () => {
  const { service, getWrites, periodId } = fixture("không sử dụng");
  for (const dto of [
    { reportType: "SUMMARY_ALL_UNITS", format: "PDF" },
    { reportType: "SUMMARY_ALL_UNITS", format: "DOCX" },
    { reportType: "UNIT_APPRAISAL_MINUTES", format: "XLSX" },
  ] as const) await assert.rejects(service.create("admin", { periodId, ...dto }), /Định dạng không phù hợp/);
  await assert.rejects(service.create("admin", { periodId, reportType: "UNIT_APPRAISAL_MINUTES", format: "PDF" }), /cần mã hồ sơ/);
  await assert.rejects(service.create("admin", { periodId, evaluationId: randomUUID(), reportType: "SUMMARY_ALL_UNITS", format: "XLSX" }), /không được gắn/);
  assert.equal(getWrites(), 0);
});

/** Ghi tệp thất bại không được trả đường dẫn hay lỗi hệ điều hành và không ghi metadata
 * Dùng một tệp làm thư mục gốc để tái hiện lỗi trên mọi hệ điều hành
 */
test("che lỗi lưu tệp và không ghi metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vc15-"));
  try {
    const root = join(dir, "khong-phai-thu-muc");
    await writeFile(root, "dữ liệu có sẵn");
    const { service, getWrites, periodId } = fixture(root);
    await assert.rejects(service.create("admin", { periodId, reportType: "SUMMARY_ALL_UNITS", format: "XLSX" }), /Không thể lưu tệp báo cáo/);
    assert.equal(getWrites(), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/** Khi giao dịch metadata hoặc audit thất bại phải xóa tệp đã tạo để không để lại bản mồ côi
 * Thư mục thử được cô lập và chỉ bị xóa sau khi đã kiểm nội dung
 */
test("dọn tệp khi giao dịch thất bại", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vc15-"));
  try {
    const { service, getWrites, periodId } = fixture(dir);
    await assert.rejects(service.create("admin", { periodId, reportType: "SUMMARY_ALL_UNITS", format: "XLSX" }), /Không thể lưu thông tin báo cáo/);
    assert.equal(getWrites(), 1);
    assert.deepEqual(await readdir(join(dir, periodId)), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/** Đảm bảo validation không bỏ qua mã hồ sơ thiếu/null khi là biên bản
 * Tổng hợp không có evaluationId là hợp lệ, chuỗi rỗng hoặc UUID sai đều bị chặn
 */
test("DTO kiểm mã hồ sơ theo loại báo cáo kể cả thiếu và null", async () => {
  const common = { periodId: randomUUID(), reportType: "UNIT_APPRAISAL_MINUTES", format: "PDF" };
  for (const evaluationId of [undefined, null, "", "sai mã"]) {
    const errors = await validate(Object.assign(new CreateReportExportDto(), { ...common, evaluationId }));
    assert.ok(errors.length > 0);
  }
  assert.equal((await validate(Object.assign(new CreateReportExportDto(), { ...common, evaluationId: randomUUID() }))).length, 0);
  const summary = { ...common, reportType: "SUMMARY_ALL_UNITS", format: "XLSX" };
  assert.equal((await validate(Object.assign(new CreateReportExportDto(), summary))).length, 0);
  assert.ok((await validate(Object.assign(new CreateReportExportDto(), { ...summary, evaluationId: null }))).length);
});

/** Bộ dọn giữ tệp có tham chiếu hoặc mới tạo, chỉ xóa mồ côi cũ
 * Nếu DB kiểm tham chiếu hỏng phải giữ nguyên tệp để lần quét sau thử lại
 */
test("bộ dọn chỉ xóa tệp cũ khi DB xác nhận không có tham chiếu", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vc15-"));
  try {
    const { storage, periodId } = fixture(dir);
    const key = `${periodId}/${randomUUID()}-summary-all-units-2026.xlsx`;
    await storage.put(key, Buffer.from("báo cáo"));
    assert.equal(await storage.cleanup(async () => false), 0);
    const future = new Date(Date.now() + 2 * 86400000);
    assert.equal(await storage.cleanup(async () => true, future), 0);
    assert.equal(await storage.cleanup(async () => { throw new Error("DB chưa sẵn sàng"); }, future), 0);
    assert.equal(await storage.cleanup(async () => false, future), 1);
    await assert.rejects(storage.get(key));
    await assert.rejects(storage.get("../ngoai-kho"), /Không tìm thấy/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
