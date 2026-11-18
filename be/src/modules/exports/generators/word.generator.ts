import { Injectable } from "@nestjs/common";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { appraisalSections, reportDate, reportStatus, reportValue, scoreDetails, type AppraisalReportData, type GeneratedReport } from "./report-data.js";

/** Tạo biên bản Word từ cùng snapshot với PDF, chỉ dựng cấu trúc OOXML và không chèn HTML */
@Injectable()
export class WordReportGenerator {
  /** Dựng bảng điểm và diễn giải đầy đủ, giữ phần ký trống để không tự tạo chữ ký hoặc con dấu
   * Nhóm là tiêu đề không có điểm; tổng chính thức và nhãn dự thảo do snapshot quyết định
   */
  async generateAppraisal(data: AppraisalReportData): Promise<GeneratedReport> {
    const sections = appraisalSections(data);
    const scoreRows = [
      this.row(["Mã", "Tiêu chí", "Tối đa", "Tự chấm", "Thẩm định", "Chênh lệch"], true),
      ...data.scores.map((score) => this.row([score.code, score.name, ...(score.isGroup ? ["", "", "", ""] : [String(score.maxScore), reportValue(score.selfScore), reportValue(score.adminScore), score.selfScore !== null && score.adminScore !== null ? String(Number((score.adminScore - score.selfScore).toFixed(2))) : "Chưa có"])])),
    ];
    const document = new Document({
      creator: data.period.createdByName, title: "Biên bản thẩm định kết quả thi đua",
      styles: { default: { document: { run: { font: "Times New Roman", size: 22 }, paragraph: { spacing: { after: 100 } } } } },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 850, right: 850 } } }, children: [
        new Paragraph({ text: "BIÊN BẢN THẨM ĐỊNH KẾT QUẢ THI ĐUA", heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
        ...sections.heading.map((text) => new Paragraph(text)),
        new Paragraph({ text: "CHI TIẾT TIÊU CHÍ", heading: HeadingLevel.HEADING_1 }),
        new Table({ rows: scoreRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
        ...data.scores.flatMap((score) => [
          new Paragraph({ text: `${score.code} — ${score.name}`, heading: score.isGroup ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3 }),
          ...scoreDetails(score).map((text) => new Paragraph(text)),
        ]),
        new Paragraph({ text: "TỔNG KẾT VÀ LỊCH BỔ SUNG", heading: HeadingLevel.HEADING_1 }),
        ...sections.conclusion.map((text) => new Paragraph(text)),
        new Paragraph({ text: "LỊCH SỬ HỒ SƠ", heading: HeadingLevel.HEADING_1 }),
        ...(data.histories.length ? data.histories.map((history) => new Paragraph(`${reportDate(history.createdAt)} — ${history.actorName}: ${reportStatus(history.fromStatus)} → ${reportStatus(history.toStatus)}; ${history.comment ?? "Không có ghi chú"}`)) : [new Paragraph("Chưa có lịch sử chuyển trạng thái")]),
        new Paragraph({ text: "NHẬN XÉT VÀ PHẢN HỒI", heading: HeadingLevel.HEADING_1 }),
        ...(data.feedbacks.length ? data.feedbacks.map((feedback) => new Paragraph(`${reportDate(feedback.createdAt)} — ${feedback.authorName} (${feedback.type}): ${feedback.content}`)) : [new Paragraph("Chưa có phản hồi")]),
        new Paragraph({ text: "XÁC NHẬN", heading: HeadingLevel.HEADING_1 }),
        new Table({ rows: [this.row(["ĐẠI DIỆN ĐƠN VỊ", "BAN THANH NIÊN"], true), this.row(["(Ký, ghi rõ họ tên)", "(Ký, ghi rõ họ tên)"]), this.row(["", ""]), this.row(["", ""])], width: { size: 100, type: WidthType.PERCENTAGE } }),
        new Paragraph("Mẫu làm việc phục vụ đồ án, đối chiếu lại khi có mẫu hành chính chính thức"),
      ] }],
    });
    return { buffer: await Packer.toBuffer(document), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" };
  }

  /** Dựng một hàng bảng bằng văn bản thuần và đánh dấu header lặp cho bảng dài
   * Giá trị null đã được caller đổi thành nhãn, mọi ký tự XML được thư viện escape
   */
  private row(values: string[], header = false): TableRow {
    return new TableRow({ tableHeader: header, children: values.map((text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: header })] })] })) });
  }
}
