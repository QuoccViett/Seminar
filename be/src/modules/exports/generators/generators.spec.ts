import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { ExcelReportGenerator } from "./excel.generator.js";
import { PdfReportGenerator } from "./pdf.generator.js";
import { WordReportGenerator } from "./word.generator.js";
import type { AppraisalReportData, ReportPeriodData, SummaryReportData } from "./report-data.js";
import { readReportExcel, readReportPdf, readReportWord } from "../../../../test/integration/vc15-files.js";

/** Snapshot cố định phục vụ parser độc lập, không gọi hoặc thay backend thật của luồng nghiệm thu
 * Ngưỡng giữ nhãn theo kỳ, thời gian UTC cố định để kiểm hiển thị Việt Nam không phụ thuộc máy chạy
 */
const period: ReportPeriodData = { id: "period", year: 2026, name: "Kỳ thi đua tiếng Việt", phase: "FINAL_REVIEW", maxTotalScore: 90,
  generatedAt: new Date("2026-11-18T00:00:00Z"), createdByName: "Quản trị viên", thresholds: [{ rating: "GOOD", label: "Hoàn thành tốt nhiệm vụ", minPercent: 65, minExclusive: false, color: "#DDEEFF" }] };

/** Kiểm quy mô bộ demo 34 đơn vị cùng ký tự có nguy cơ thành công thức
 * Mọi cột số phải giữ kiểu number còn chuỗi =,+,-,@ phải giữ đúng văn bản khi đọc lại XLSX
 */
test("XLSX 34 đơn vị giữ số và chuỗi thuần, không cắt mất dòng cuối", async () => {
  const data: SummaryReportData = { period, rows: Array.from({ length: 34 }, (_, index) => ({ unitCode: `DV${index}`, unitName: `${["=", "+", "-", "@"][index % 4]}Đơn vị tiếng Việt ${index}`, evaluationStatus: "FINALIZED", submittedAt: period.generatedAt, finalizedAt: period.generatedAt,
    selfTotal: 90, currentTotal: 63, finalScore: 63, finalPercent: 70, finalRating: "GOOD", ratingLabel: "Hoàn thành tốt nhiệm vụ", ratingColor: "#DDEEFF" })) };
  const workbook = await readReportExcel((await new ExcelReportGenerator().generateSummary(data)).buffer);
  const sheet = workbook.getWorksheet("Tổng hợp")!;
  assert.equal(sheet.rowCount, 42); assert.equal(sheet.getCell("A41").value, 34);
  assert.equal(sheet.getCell("E42").value, 3060); assert.equal(sheet.getCell("G42").value, 2142);
  for (let row = 8; row <= 41; row++) { assert.equal(sheet.getCell(`C${row}`).type, 3); assert.equal(typeof sheet.getCell(`G${row}`).value, "number"); }
  assert.match(String(sheet.getCell("D4").value ?? sheet.getCell("A4").value), /07:00:00/);
});

/** Kiểm 30 lá và diễn giải dài qua nhiều trang bằng bytes PDF/Word thật
 * Điểm nhóm rỗng và phần cuối/chữ ký phải còn nguyên, ký tự XML được escape thay vì mất nội dung
 */
test("biên bản 30 tiêu chí dài giữ tiếng Việt qua ngắt trang PDF và Word", async () => {
  const data: AppraisalReportData = {
    period, unit: { code: "DV01", name: "Đơn vị thẩm định tiếng Việt" },
    evaluation: { id: "evaluation", status: "PENDING_REVIEW", submittedAt: period.generatedAt, finalizedAt: null, supplementRequestedAt: null, supplementStartAt: null, supplementDeadline: null, supplementSubmittedAt: null,
      finalScore: null, finalPercent: null, finalRating: null, finalRatingLabel: null, finalizedByName: null, selfTotal: 90, currentTotal: 63, currentPercent: 70, currentRatingLabel: "Hoàn thành tốt nhiệm vụ" },
    scores: Array.from({ length: 30 }, (_, index) => ({ code: `TC${index + 1}`, name: `Tiêu chí tiếng Việt ${index + 1} & đối chiếu`, depth: 1, isGroup: false, maxScore: 3, selfScore: 3, adminScore: 2.1, currentScore: 2.1,
      selfNote: "Diễn giải kết quả có dấu và ngắt trang ".repeat(20), adminComment: "Lý do điều chỉnh điểm thẩm định", reviewerName: "Người thẩm định", reviewedAt: period.generatedAt,
      evidences: [{ id: "tham-chieu", label: "Báo cáo kiểm chứng.docx", round: "INITIAL" }], needsSupplement: false, supplementNote: null, supplementedAt: null, baseline: null })),
    feedbacks: [{ type: "GENERAL", content: "KẾT THÚC NỘI DUNG KIỂM CHỨNG", authorName: "Người kiểm", createdAt: period.generatedAt }], histories: [],
  };
  const pdf = await readReportPdf((await new PdfReportGenerator(new ConfigService()).generateAppraisal(data)).buffer);
  const xml = await readReportWord((await new WordReportGenerator().generateAppraisal(data)).buffer);
  assert.ok(pdf.pages >= 5); assert.ok(pdf.text.includes("TC30"));
  assert.ok(pdf.text.includes("KẾT THÚC NỘI DUNG KIỂM CHỨNG") && pdf.text.includes("BAN THANH NIÊN"));
  assert.ok(xml.includes("TC30") && xml.includes("&amp; đối chiếu")); assert.ok(xml.includes("CHƯA CHỐT"));
});
