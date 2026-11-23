import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph } from "docx";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

/** Ảnh demo tự vẽ gồm tiêu đề và biểu đồ, có bytes PNG thật và không cần trình duyệt khi seed */
function demoPng(): Buffer {
  const width = 800; const height = 480;
  const pixels = Buffer.alloc(height * (width * 3 + 1), 255);
  for (let y = 0; y < height; y++) pixels[y * (width * 3 + 1)] = 0;
  const rectangle = (left: number, top: number, right: number, bottom: number, rgb: number[]) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels[offset] = rgb[0]; pixels[offset + 1] = rgb[1]; pixels[offset + 2] = rgb[2];
    }
  };
  rectangle(0, 0, width, 140, [29, 78, 216]);
  const glyphs = ["111101101101101101111", "111100100110100100111", "101111111101101101101", "111101101101101101111"];
  // Chữ DEMO được vẽ từ lưới bảy hàng, không phụ thuộc font hoặc ảnh bên ngoài
  glyphs[0] = "110101101101101101110";
  for (const [index, glyph] of glyphs.entries()) for (let row = 0; row < 7; row++) for (let column = 0; column < 3; column++) {
    if (glyph[row * 3 + column] === "1") rectangle(45 + index * 65 + column * 12, 28 + row * 12, 55 + index * 65 + column * 12, 38 + row * 12, [255, 255, 255]);
  }
  for (const [index, length] of [520, 410, 310, 190].entries()) {
    rectangle(48, 180 + index * 65, 748, 214 + index * 65, [241, 245, 249]);
    rectangle(48, 180 + index * 65, 48 + length, 214 + index * 65, [[21, 128, 61], [29, 78, 216], [180, 83, 9], [185, 28, 28]][index]);
  }
  const chunk = (type: string, bytes: Buffer) => {
    const name = Buffer.from(type); const content = Buffer.concat([name, bytes]);
    let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const result = Buffer.alloc(bytes.length + 12); result.writeUInt32BE(bytes.length); name.copy(result, 4); bytes.copy(result, 8); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length + 8); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

/** Minh chứng do dự án tự tạo, dùng font đã đóng gói và không tham chiếu đường dẫn giả */
export async function seedAssets() {
  const pdf = new PDFDocument(); const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((done, reject) => { pdf.on("data", (chunk: Buffer) => chunks.push(chunk)); pdf.on("end", () => done(Buffer.concat(chunks))); pdf.on("error", reject); });
  pdf.font(resolve("assets/fonts/NotoSans-Regular.ttf")).fontSize(16).text("Minh chứng demo do nhóm tự tạo").fontSize(12).text("Tài liệu dùng để diễn tập xem trước và tải minh chứng; không đại diện kết quả nghiệp vụ thật."); pdf.end();
  return [
    { extension: "pdf", mime: "application/pdf", bytes: await complete },
    { extension: "png", mime: "image/png", bytes: demoPng() },
    { extension: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Biên bản minh chứng demo do nhóm tự tạo, phục vụ diễn tập")] }] })) },
  ];
}
