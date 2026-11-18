import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { appraisalSections, reportDate, reportStatus, reportValue, scoreDetails, type AppraisalReportData, type GeneratedReport } from "./report-data.js";

/** Tạo PDF có font Noto Sans nhúng để đọc và trích xuất tiếng Việt trên máy không cài font
 * Dùng bố cục dòng chảy A4 để nội dung minh chứng hoặc nhận xét dài tự ngắt trang
 */
@Injectable()
export class PdfReportGenerator {
  /** Nhận cấu hình font thay thế tùy chọn, mặc định luôn dùng font Unicode được đóng gói */
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  /** Ghi trọn biên bản theo snapshot, nhóm không được tính điểm và chữ ký để trống
   * Lắng nghe lỗi stream trước khi render để lỗi font hoặc ghi PDF không làm request treo
   */
  async generateAppraisal(data: AppraisalReportData): Promise<GeneratedReport> {
    const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: "Biên bản thẩm định kết quả thi đua", Author: data.period.createdByName } });
    const chunks: Buffer[] = [];
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    try {
      const regular = this.config.get<string>("REPORT_EXPORT_FONT_PATH") || fileURLToPath(new URL("../../../../assets/fonts/NotoSans-Regular.ttf", import.meta.url));
      const bold = fileURLToPath(new URL("../../../../assets/fonts/NotoSans-Bold.ttf", import.meta.url));
      doc.registerFont("Report", regular); doc.registerFont("ReportBold", bold);
      doc.font("ReportBold").fontSize(15).text("BIÊN BẢN THẨM ĐỊNH KẾT QUẢ THI ĐUA", { align: "center" });
      doc.moveDown();
      const sections = appraisalSections(data);
      for (const line of sections.heading) this.line(doc, line);
      this.heading(doc, "CHI TIẾT TIÊU CHÍ");
      for (const score of data.scores) {
        this.heading(doc, `${score.code} — ${score.name}`, score.isGroup ? 12 : 10);
        if (!score.isGroup) {
          this.line(doc, `Tối đa: ${score.maxScore} | Tự chấm: ${reportValue(score.selfScore)} | Thẩm định: ${reportValue(score.adminScore)} | Chênh lệch: ${score.selfScore !== null && score.adminScore !== null ? Number((score.adminScore - score.selfScore).toFixed(2)) : "Chưa có"}`);
          for (const line of scoreDetails(score)) this.line(doc, line);
        }
      }
      this.heading(doc, "TỔNG KẾT VÀ LỊCH BỔ SUNG");
      for (const line of sections.conclusion) this.line(doc, line);
      this.heading(doc, "LỊCH SỬ HỒ SƠ");
      if (!data.histories.length) this.line(doc, "Chưa có lịch sử chuyển trạng thái");
      for (const history of data.histories) this.line(doc, `${reportDate(history.createdAt)} — ${history.actorName}: ${reportStatus(history.fromStatus)} → ${reportStatus(history.toStatus)}; ${history.comment ?? "Không có ghi chú"}`);
      this.heading(doc, "NHẬN XÉT VÀ PHẢN HỒI");
      if (!data.feedbacks.length) this.line(doc, "Chưa có phản hồi");
      for (const feedback of data.feedbacks) this.line(doc, `${reportDate(feedback.createdAt)} — ${feedback.authorName} (${feedback.type}): ${feedback.content}`);
      this.heading(doc, "XÁC NHẬN");
      this.line(doc, "ĐẠI DIỆN ĐƠN VỊ                                      BAN THANH NIÊN");
      this.line(doc, "(Ký, ghi rõ họ tên)                                      (Ký, ghi rõ họ tên)");
      doc.moveDown(3);
      this.line(doc, "Mẫu làm việc phục vụ đồ án, đối chiếu lại khi có mẫu hành chính chính thức");
      doc.end();
    } catch {
      // Hủy stream bằng lỗi dự án để font hoặc thư viện không lộ đường dẫn vào tầng HTTP
      doc.destroy(new Error("Không thể tạo nội dung PDF tiếng Việt"));
    }
    return { buffer: await finished, contentType: "application/pdf", extension: "pdf" };
  }

  /** Giữ tiêu đề gần nội dung kế tiếp, chỉ chủ động sang trang khi khoảng trống không đủ */
  private heading(doc: PDFKit.PDFDocument, text: string, size = 12): void {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();
    doc.moveDown(0.5).font("ReportBold").fontSize(size).text(text);
    doc.moveDown(0.3);
  }

  /** Ghi một đoạn Unicode có thể dài nhiều trang, PDFKit tự wrap và giữ lề A4 */
  private line(doc: PDFKit.PDFDocument, text: string): void {
    doc.font("Report").fontSize(10).text(text, { lineGap: 3 });
    doc.moveDown(0.3);
  }
}
