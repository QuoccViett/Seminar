import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Đọc lại XLSX bằng parser độc lập với luồng ghi để kiểm số, tiếng Việt và cấu hình in
 * Trả workbook cho bài kiểm đối chiếu từng dòng với snapshot DB đã biết trước
 */
export async function readReportExcel(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  assert.ok(workbook.getWorksheet("Tổng hợp"));
  assert.ok(workbook.getWorksheet("Chú giải"));
  return workbook;
}

/** Mở DOCX như ZIP thật và lấy XML chính, không chỉ kiểm tên mở rộng hoặc magic bytes */
export async function readReportWord(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  assert.ok(file, "Word phải có phần nội dung XML");
  return file.async("string");
}

/** Trích text Unicode từ mọi trang PDF bằng PDF.js với thực thi JavaScript bị tắt
 * Không dùng OCR hoặc dữ liệu đầu vào generator làm bằng chứng, chỉ đọc bytes đã tải
 */
export async function readReportPdf(bytes: Buffer) {
  const document = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const pages = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return { text: pages.join("\n").normalize("NFC"), pages: document.numPages };
  } finally { await document.destroy(); }
}
