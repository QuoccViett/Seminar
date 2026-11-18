import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import type { ExportsService } from "../../src/modules/exports/exports.service.js";
import type { ReportStorageService } from "../../src/modules/exports/report-storage.service.js";
import { createVc12Harness } from "./vc12-support.js";
import { readReportExcel, readReportPdf, readReportWord } from "./vc15-files.js";

interface Metadata { id: string; fileName: string; sizeBytes: number; status: string; downloadUrl: string; downloadExpiresAt: string; storagePath?: string; items: Metadata[]; total: number; page: number; pageSize: number; code: string; message: string }

/** Kiểm API, DB và bytes thật trên database VC15 local riêng, không reset hoặc gửi provider
 * Fixture chỉ dựng đầu ra các chặng trước, mọi lần tạo và tải báo cáo đi qua HTTP Nest thật
 */
test("VC15 báo cáo, quyền, scope, tệp và phục hồi trên HTTP/PostgreSQL", async (t) => {
  const h = await createVc12Harness({ url: process.env.VC15_TEST_DATABASE_URL, name: "vc15_test" });
  const dist = new URL("../../dist/", import.meta.url);
  const { ConfigService: ConfigToken } = await import("@nestjs/config");
  const { JwtService: JwtToken } = await import("@nestjs/jwt");
  const { ExportsService: ExportToken } = await import(new URL("modules/exports/exports.service.js", dist).href);
  const { ReportStorageService: StorageToken } = await import(new URL("modules/exports/report-storage.service.js", dist).href);
  const service = h.app.get<ExportsService>(ExportToken); service.onModuleDestroy();
  const storage = h.app.get<ReportStorageService>(StorageToken);
  const config = h.app.get<ConfigService>(ConfigToken); const jwt = h.app.get<JwtService>(JwtToken);
  const root = config.getOrThrow<string>("REPORT_EXPORT_DIR");
  const exportsPath = "admin/reports/exports";
  const sample = await h.scenario(3, 100, [50.25, 34.75]);
  const other = await h.scenario(1, 100, [40, 20]);
  const [first, second, third] = sample.records;
  let excel: Metadata; let pdf: Metadata; let word: Metadata;

  /** Gửi JSON không bọc mock và giữ header cache để kiểm giao ước metadata */
  async function request(method: string, path: string, body?: unknown, token: string | null = h.adminToken) {
    const response = await fetch(`${h.base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() as Metadata };
  }
  /** Đọc bytes của URL ký đúng như FE, chữ ký không được coi là thay thế access token */
  async function download(metadata: Metadata, token: string | null = h.adminToken) {
    const response = await fetch(`${h.base}${metadata.downloadUrl}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { response, bytes: Buffer.from(await response.arrayBuffer()) };
  }
  /** Tạo biên bản hoặc tổng hợp và yêu cầu đủ metadata cùng URL có hạn, không có path private */
  async function create(format: "XLSX" | "PDF" | "DOCX", evaluationId?: string) {
    const result = await request("POST", exportsPath, { periodId: sample.periodId, reportType: format === "XLSX" ? "SUMMARY_ALL_UNITS" : "UNIT_APPRAISAL_MINUTES", format, ...(evaluationId ? { evaluationId } : {}) });
    assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.cache, "private, no-store");
    assert.equal(result.body.status, "READY"); assert.equal(result.body.storagePath, undefined);
    assert.ok(Date.parse(result.body.downloadExpiresAt) > Date.now());
    return result.body;
  }
  try {
    await t.test("chặn quyền và payload hoặc scope sai trước khi lưu", async () => {
      const valid = { periodId: sample.periodId, reportType: "SUMMARY_ALL_UNITS", format: "XLSX" };
      assert.equal((await request("POST", exportsPath, valid, null)).status, 401);
      assert.equal((await request("POST", exportsPath, valid, first.token)).status, 403);
      assert.equal((await request("GET", exportsPath, undefined, first.token)).status, 403);
      const before = await h.prisma.reportExport.count();
      for (const body of [{ ...valid, format: "PDF" }, { ...valid, format: "DOCX" }, { ...valid, evaluationId: first.evaluationId }, { ...valid, evaluationId: null }, { ...valid, periodId: "sai mã" }, { ...valid, storagePath: "khong-duoc-nhan" }, { ...valid, reportType: "UNIT_APPRAISAL_MINUTES", format: "PDF" }, { ...valid, reportType: "UNIT_APPRAISAL_MINUTES", format: "DOCX", evaluationId: null }, { ...valid, reportType: "UNIT_APPRAISAL_MINUTES", evaluationId: first.evaluationId }, { ...valid, reportType: "UNIT_APPRAISAL_MINUTES", format: "PDF", evaluationId: other.records[0].evaluationId }]) {
        const result = await request("POST", exportsPath, body); assert.equal(result.status, 400, JSON.stringify(body)); assert.match(result.body.message, /[À-ỹ]/u);
      }
      assert.equal((await request("POST", exportsPath, { ...valid, periodId: randomUUID() })).status, 404);
      assert.equal((await request("POST", exportsPath, { ...valid, reportType: "UNIT_APPRAISAL_MINUTES", format: "PDF", evaluationId: randomUUID() })).status, 404);
      assert.equal(await h.prisma.reportExport.count(), before);
    });

    await t.test("XLSX có số thật, đúng kỳ, chú giải, định dạng in và phân biệt chưa chốt", async () => {
      await h.prisma.unit.update({ where: { id: first.unitId }, data: { name: "=Đơn vị tiếng Việt có dấu", sortOrder: 0 } });
      await h.prisma.unit.update({ where: { id: second.unitId }, data: { sortOrder: 1 } });
      await h.prisma.unit.update({ where: { id: third.unitId }, data: { sortOrder: 2 } });
      await h.prisma.ratingThreshold.updateMany({ where: { periodId: sample.periodId, rating: "GOOD" }, data: { color: "#12AB34" } });
      assert.equal((await h.request("PUT", `admin/evaluations/${first.evaluationId}/scores/${sample.leaf1}/review`, h.adminToken, { adminScore: 49.25, adminComment: "Điều chỉnh vì thiếu báo cáo chuyên đề" })).status, 200);
      await h.firstReview(first.evaluationId);
      await h.prisma.evaluationPeriod.update({ where: { id: sample.periodId }, data: { phase: "FINAL_REVIEW" } });
      assert.equal((await h.request("POST", `admin/evaluations/${first.evaluationId}/finalize`, h.adminToken, {})).status, 200);
      // Chỉ fixture test chuyển lại phase để tạo nhánh bổ sung cho hồ sơ khác, API sản phẩm không cho quay lùi
      await h.prisma.evaluationPeriod.update({ where: { id: sample.periodId }, data: { phase: "FIRST_REVIEW" } });
      excel = await create("XLSX"); const file = await download(excel);
      assert.equal(file.response.status, 200); assert.equal(file.bytes.length, excel.sizeBytes);
      assert.equal(file.response.headers.get("cache-control"), "private, no-store");
      assert.match(file.response.headers.get("content-type")!, /spreadsheetml/);
      assert.match(file.response.headers.get("content-disposition")!, /filename\*=UTF-8/);
      const workbook = await readReportExcel(file.bytes); const sheet = workbook.getWorksheet("Tổng hợp")!;
      assert.equal(sheet.rowCount, 11); assert.equal(sheet.getCell("C8").value, "=Đơn vị tiếng Việt có dấu");
      assert.equal(sheet.getCell("C8").type, 3); assert.equal(sheet.getCell("E8").value, 85); assert.equal(sheet.getCell("F8").value, 84); assert.equal(sheet.getCell("G8").value, 84);
      assert.equal(sheet.getCell("H8").value, 84); assert.equal(sheet.getCell("I8").value, "Tốt");
      assert.equal(sheet.getCell("G9").value, null); assert.equal(sheet.getCell("I9").value, null);
      assert.equal(sheet.getCell("E11").value, 255); assert.equal(sheet.getCell("F11").value, 254); assert.equal(sheet.getCell("G11").value, 84);
      assert.equal(sheet.pageSetup.orientation, "landscape"); assert.equal(sheet.pageSetup.paperSize, 9); assert.equal(sheet.pageSetup.printTitlesRow, "1:7");
      assert.equal((sheet.getCell("I8").fill as { fgColor?: { argb?: string } }).fgColor?.argb, "FF12AB34");
      assert.equal(sheet.getCell("C8").font.name, "Times New Roman");
      assert.match(String(sheet.getCell("L9").value), /CHƯA CHỐT/);
      await mkdir(".tmp/vc15-artifacts", { recursive: true }); await writeFile(".tmp/vc15-artifacts/tong-hop.xlsx", file.bytes);
    });

    await t.test("PDF và Word đọc được tiếng Việt, điểm, lý do, minh chứng và lịch sử bổ sung", async () => {
      await h.supplement(sample, 1);
      assert.equal((await h.request("PUT", `evaluations/${second.evaluationId}/scores/${sample.leaf1}/self`, second.token, { selfScore: 50.5, selfNote: "Nội dung bổ sung tiếng Việt đầy đủ" })).status, 200);
      assert.equal((await h.request("POST", `evaluations/${second.evaluationId}/supplement-submit`, second.token, {})).status, 200);
      // UNIT phản hồi lần đầu, không gửi thêm bằng ADMIN ngay sau yêu cầu để giữ nguyên chặn spam 30 giây
      assert.equal((await h.request("POST", `evaluations/${second.evaluationId}/feedback`, second.token, { type: "UNIT_REPLY", content: "Báo cáo bổ sung tiếng Việt đã được cập nhật" })).status, 201);
      pdf = await create("PDF", second.evaluationId); word = await create("DOCX", second.evaluationId);
      const pdfFile = await download(pdf); const wordFile = await download(word);
      assert.equal(pdfFile.response.status, 200); assert.equal(wordFile.response.status, 200);
      assert.match(pdfFile.response.headers.get("content-type")!, /application\/pdf/);
      const parsed = await readReportPdf(pdfFile.bytes); const xml = await readReportWord(wordFile.bytes);
      for (const text of ["BIÊN BẢN THẨM ĐỊNH KẾT QUẢ THI ĐUA", "CHƯA CHỐT", "TẠM TÍNH", "Minh chứng", "LỊCH SỬ HỒ SƠ", "Trước bổ sung", "BAN THANH NIÊN", "Nội dung bổ sung tiếng Việt đầy đủ", "Báo cáo bổ sung tiếng Việt đã được cập nhật"]) {
        assert.ok(parsed.text.includes(text), `PDF thiếu nội dung: ${text}`); assert.ok(xml.includes(text), `Word thiếu nội dung: ${text}`);
      }
      assert.ok(parsed.pages >= 2); assert.ok(xml.includes("w:tblHeader"));
      assert.ok(!xml.includes("storagePath") && !parsed.text.includes("storagePath"));
      await writeFile(".tmp/vc15-artifacts/bien-ban-du-thao.pdf", pdfFile.bytes); await writeFile(".tmp/vc15-artifacts/bien-ban-du-thao.docx", wordFile.bytes);
      // Biên bản đã chốt phải hiển thị điểm chính thức và lý do điều chỉnh của hồ sơ đầu tiên
      const finalPdf = await create("PDF", first.evaluationId); const finalText = await readReportPdf((await download(finalPdf)).bytes);
      assert.ok(finalText.text.includes("KẾT QUẢ ĐÃ CHỐT")); assert.ok(finalText.text.includes("Điều chỉnh vì thiếu báo cáo chuyên đề"));
      assert.ok(finalText.text.includes("Điểm chính thức: 84")); assert.ok(!finalText.text.includes("CHƯA CHỐT"));
      const finalWord = await create("DOCX", first.evaluationId); const finalXml = await readReportWord((await download(finalWord)).bytes);
      assert.ok(finalXml.includes("KẾT QUẢ ĐÃ CHỐT")); assert.ok(finalXml.includes("Điểm chính thức: 84"));
    });

    await t.test("URL có hạn ràng buộc mục đích, người đọc, báo cáo và quyền ADMIN", async () => {
      assert.equal((await download(excel, null)).response.status, 401);
      assert.equal((await download(excel, first.token)).response.status, 403);
      assert.equal((await request("GET", `${exportsPath}/${excel.id}/download`)).status, 400);
      const expired = jwt.sign({ purpose: "REPORT_DOWNLOAD", sub: h.adminId, reportId: excel.id, exp: Math.floor(Date.now() / 1000) - 1 }, { audience: "seminar-report-download" });
      const wrongActor = jwt.sign({ purpose: "REPORT_DOWNLOAD", sub: second.userId, reportId: excel.id }, { audience: "seminar-report-download", expiresIn: 120 });
      const wrongPurpose = jwt.sign({ purpose: "ACCESS", sub: h.adminId, reportId: excel.id }, { audience: "seminar-report-download", expiresIn: 120 });
      for (const token of [expired, wrongActor, wrongPurpose]) assert.equal((await request("GET", `${exportsPath}/${excel.id}/download?token=${token}`)).status, 403);
      const wrongReport = { ...excel, downloadUrl: excel.downloadUrl.replace(excel.id, word.id) };
      assert.equal((await download(wrongReport)).response.status, 403);
      const tampered = { ...excel, downloadUrl: excel.downloadUrl.slice(0, -8) + "AAAAAAAA" };
      assert.equal((await download(tampered)).response.status, 403);
      const renewed = await request("GET", `${exportsPath}/${excel.id}`); assert.equal(renewed.status, 200);
      assert.equal((await download(renewed.body)).response.status, 200);
      const user = await h.prisma.user.findUniqueOrThrow({ where: { id: h.adminId } });
      await h.prisma.user.update({ where: { id: h.adminId }, data: { mustChangePassword: true } });
      try { assert.equal((await download(excel)).response.status, 403); }
      finally { await h.prisma.user.update({ where: { id: h.adminId }, data: { mustChangePassword: user.mustChangePassword } }); }
    });

    await t.test("list lọc, phân trang ổn định và không lộ path hoặc token trong audit", async () => {
      const list = await request("GET", `${exportsPath}?periodId=${sample.periodId}&format=DOCX&reportType=UNIT_APPRAISAL_MINUTES&evaluationId=${second.evaluationId}&pageSize=1`);
      assert.equal(list.status, 200); assert.equal(list.cache, "private, no-store"); assert.equal(list.body.total, 1); assert.equal(list.body.items[0].id, word.id);
      assert.ok(!JSON.stringify(list.body).includes("storagePath"));
      const page1 = await request("GET", `${exportsPath}?periodId=${sample.periodId}&pageSize=2&page=1`);
      const page2 = await request("GET", `${exportsPath}?periodId=${sample.periodId}&pageSize=2&page=2`);
      assert.equal(page1.body.total, 5); assert.equal(page1.body.items.length, 2); assert.equal(page2.body.items.length, 2);
      assert.ok(page1.body.items.every((item) => !page2.body.items.some((other) => other.id === item.id)));
      assert.equal((await request("GET", `${exportsPath}?periodId=${other.periodId}`)).body.total, 0);
      assert.equal((await request("GET", `${exportsPath}?pageSize=101`)).status, 400);
      const audits = await h.prisma.auditLog.findMany({ where: { entity: "ReportExport", entityId: excel.id } });
      assert.equal(audits.filter((item) => item.action === "REPORT_EXPORTED").length, 1);
      assert.ok(audits.some((item) => item.action === "REPORT_DOWNLOADED"));
      assert.ok(!/storagePath|downloadUrl|token/i.test(JSON.stringify(audits)));
    });

    await t.test("storage lỗi và audit lỗi không để lại metadata thành công hoặc tệp mồ côi", async () => {
      const before = await h.prisma.reportExport.count();
      const blocked = resolve(".tmp/vc15-blocked-root"); await writeFile(blocked, "Tệp kiểm lỗi kho");
      config.set("REPORT_EXPORT_DIR", blocked);
      try { const result = await request("POST", exportsPath, { periodId: sample.periodId, reportType: "SUMMARY_ALL_UNITS", format: "XLSX" }); assert.equal(result.status, 503); assert.ok(!JSON.stringify(result.body).includes(blocked)); }
      finally { config.set("REPORT_EXPORT_DIR", root); }
      assert.equal(await h.prisma.reportExport.count(), before);
      const originalAudit = h.audit.record.bind(h.audit);
      h.audit.record = async (entry, tx) => { if (entry.action === "REPORT_EXPORTED") throw new Error("Lỗi audit giả lập an toàn"); return originalAudit(entry, tx); };
      const filesBefore = await readdir(resolve(root, sample.periodId));
      try { assert.equal((await request("POST", exportsPath, { periodId: sample.periodId, reportType: "SUMMARY_ALL_UNITS", format: "XLSX" })).status, 500); }
      finally { h.audit.record = originalAudit; }
      assert.equal(await h.prisma.reportExport.count(), before); assert.deepEqual(await readdir(resolve(root, sample.periodId)), filesBefore);
      const saved = await h.prisma.reportExport.findUniqueOrThrow({ where: { id: excel.id } });
      assert.ok(saved.storagePath.length > 0); assert.ok((await readFile(resolve(root, saved.storagePath))).length > 0);
    });

    await t.test("font lỗi được che và bộ dọn chỉ xóa mồ côi quá 24 giờ", async () => {
      const before = await h.prisma.reportExport.count();
      config.set("REPORT_EXPORT_FONT_PATH", "duong-dan-font-khong-ton-tai.ttf");
      try { assert.equal((await request("POST", exportsPath, { periodId: sample.periodId, evaluationId: first.evaluationId, reportType: "UNIT_APPRAISAL_MINUTES", format: "PDF" })).status, 500); }
      finally { config.set("REPORT_EXPORT_FONT_PATH", ""); }
      assert.equal(await h.prisma.reportExport.count(), before);
      const orphan = `${sample.periodId}/${randomUUID()}-summary-all-units-2026.xlsx`;
      await storage.put(orphan, Buffer.from("Tệp mồ côi kiểm phục hồi"));
      assert.equal(await service.cleanupOrphans(), 0);
      assert.equal(await service.cleanupOrphans(new Date(Date.now() + 2 * 86400000)), 1);
      await assert.rejects(storage.get(orphan));
      assert.equal((await download(excel)).response.status, 200);
      await storage.remove((await h.prisma.reportExport.findUniqueOrThrow({ where: { id: word.id } })).storagePath);
      assert.equal((await download(word)).response.status, 404);
    });

    await t.test("biên 85 phần trăm và 85,01 phần trăm dùng đúng nhãn chính thức", async () => {
      // Hai hồ sơ cùng kỳ có điểm gần nhau, chốt qua API thật để không tự gán finalRating trong fixture
      await h.firstReview(third.evaluationId);
      assert.equal((await h.request("POST", `admin/evaluations/${second.evaluationId}/accept-all`, h.adminToken, {})).status, 200);
      assert.equal((await h.request("PUT", `admin/evaluations/${second.evaluationId}/scores/${sample.leaf1}/review`, h.adminToken, { adminScore: 50.26, adminComment: "Đối chiếu ranh giới xếp loại" })).status, 200);
      await h.prisma.evaluationPeriod.update({ where: { id: sample.periodId }, data: { phase: "FINAL_REVIEW" } });
      for (const row of [second, third]) assert.equal((await h.request("POST", `admin/evaluations/${row.evaluationId}/finalize`, h.adminToken, {})).status, 200);
      const final = await create("XLSX");
      const sheet = (await readReportExcel((await download(final)).bytes)).getWorksheet("Tổng hợp")!;
      assert.equal(sheet.getCell("G9").value, 85.01); assert.equal(sheet.getCell("H9").value, 85.01); assert.equal(sheet.getCell("I9").value, "Xuất sắc");
      assert.equal(sheet.getCell("G10").value, 85); assert.equal(sheet.getCell("I10").value, "Tốt");
    });
  } finally { await h.app.close(); }
});
