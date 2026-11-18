import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { Prisma } from "../../../generated/prisma/client.js";
import { reportDate, reportStatus, type GeneratedReport, type SummaryReportData } from "./report-data.js";

/** Xuất bảng hành chính có số thật, chuỗi thuần và chú giải nguồn điểm
 * Không tạo công thức từ dữ liệu người dùng nên tên bắt đầu bằng =,+,-,@ vẫn là văn bản
 */
@Injectable()
export class ExcelReportGenerator {
  /** Dựng XLSX từ snapshot kỳ, giữ điểm chính thức rỗng trước chốt và ghi rõ tổng hiện tại tạm tính
   * Header lặp khi in A4 ngang, màu xếp loại chỉ lấy màu hex hợp lệ từ ngưỡng cấu hình
   * Trường hợp không có hồ sơ vẫn có biểu mẫu và dòng tổng hợp bằng không
   */
  async generateSummary(data: SummaryReportData): Promise<GeneratedReport> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = data.period.createdByName;
    workbook.created = data.period.generatedAt;
    const sheet = workbook.addWorksheet("Tổng hợp", { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:7" }, views: [{ state: "frozen", ySplit: 7 }] });
    sheet.addRows([
      ["BẢNG TỔNG HỢP KẾT QUẢ THI ĐUA CÁC ĐƠN VỊ"],
      [`Kỳ: ${data.period.name} — Năm: ${data.period.year}`],
      [`Tổng điểm tối đa: ${data.period.maxTotalScore}`],
      [`Xuất lúc: ${reportDate(data.period.generatedAt)} (giờ Việt Nam) — Người xuất: ${data.period.createdByName}`],
      ["Điểm thẩm định hiện tại là TẠM TÍNH; cột chính thức chỉ có dữ liệu sau khi chốt"], [],
      ["STT", "Mã đơn vị", "Tên đơn vị", "Trạng thái", "Điểm tự chấm", "Thẩm định hiện tại (tạm tính)", "Điểm chính thức", "Tỷ lệ chính thức (%)", "Xếp loại chính thức", "Thời điểm nộp (VN)", "Thời điểm chốt (VN)", "Ghi chú"],
    ]);
    for (let index = 1; index <= 5; index++) sheet.mergeCells(index, 1, index, 12);
    [7, 18, 34, 22, 15, 22, 18, 19, 32, 24, 24, 26].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    for (const [index, item] of data.rows.entries()) {
      const row = sheet.addRow([index + 1, item.unitCode, item.unitName, reportStatus(item.evaluationStatus), item.selfTotal, item.currentTotal, item.finalScore, item.finalPercent, item.ratingLabel, item.submittedAt ? reportDate(item.submittedAt) : null, item.finalizedAt ? reportDate(item.finalizedAt) : null, item.evaluationStatus === "FINALIZED" ? "Đã chốt" : "CHƯA CHỐT — TẠM TÍNH"]);
      if (item.ratingColor && /^#[0-9a-f]{6}$/i.test(item.ratingColor)) row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${item.ratingColor.slice(1).toUpperCase()}` } };
    }
    // Chỉ tổng hợp các cột điểm bằng Decimal, không cộng phần trăm hoặc xếp loại
    // Cách này giữ chính xác số thập phân dù có nhiều hồ sơ hoặc các điểm phần lẻ
    const sum = (key: "selfTotal" | "currentTotal" | "finalScore") => data.rows.reduce((total, item) => total.add(item[key] ?? 0), new Prisma.Decimal(0)).toNumber();
    sheet.addRow(["", "", "TỔNG HỢP", `${data.rows.length} hồ sơ`, sum("selfTotal"), sum("currentTotal"), sum("finalScore"), null, null, null, null, `${data.rows.filter((item) => item.evaluationStatus === "FINALIZED").length} hồ sơ đã chốt`]);
    for (let col = 5; col <= 8; col++) sheet.getColumn(col).numFmt = "0.00";
    sheet.eachRow((row, index) => {
      row.font = { name: "Times New Roman", size: index === 1 ? 16 : 11, bold: index === 1 || index === 7 || index === sheet.rowCount };
      row.alignment = { vertical: "middle", wrapText: true };
      if (index >= 7) row.eachCell({ includeEmpty: true }, (cell) => { cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } }; });
    });
    sheet.getRow(7).height = 42;
    sheet.getRow(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAF7" } };
    sheet.autoFilter = { from: "A7", to: `L${Math.max(7, data.rows.length + 7)}` };
    sheet.pageSetup.printArea = `A1:L${sheet.rowCount}`;
    const notes = workbook.addWorksheet("Chú giải");
    notes.columns = [{ width: 34 }, { width: 100 }];
    notes.addRows([["CHÚ GIẢI BÁO CÁO"], ["Kỳ", data.period.name], ["Người xuất", data.period.createdByName], ["Thời gian Việt Nam", reportDate(data.period.generatedAt)], ["Điểm tối đa", data.period.maxTotalScore], ["Tổng hiện tại", "Mỗi tiêu chí lá dùng điểm thẩm định nếu đã có, nếu chưa thì dùng tự chấm; không cộng điểm nhóm"], ["Chính thức", "Chỉ hiển thị khi hồ sơ FINALIZED, các hồ sơ còn lại là CHƯA CHỐT — TẠM TÍNH"], ["Mã loại", "Nhãn cấu hình theo kỳ"], ...data.period.thresholds.map((item) => [item.rating, `${item.label}: ${item.minExclusive ? ">" : ">="} ${item.minPercent}%`])]);
    notes.eachRow((row) => { row.font = { name: "Times New Roman", size: 11 }; row.alignment = { wrapText: true }; });
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" };
  }
}
