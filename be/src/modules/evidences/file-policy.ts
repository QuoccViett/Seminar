import { UnprocessableEntityException } from "@nestjs/common";
import JSZip from "jszip";
import * as CFB from "cfb";
import { inflateRawSync } from "node:zlib";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RECORD_BYTES = 100 * 1024 * 1024;
export const FILE_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Tạo lỗi nghiệp vụ ổn định cho nội dung không tin cậy, không phản chiếu bytes hoặc lỗi thư viện */
export function invalidFile(): UnprocessableEntityException {
  return new UnprocessableEntityException({ code: "INVALID_FILE", message: "Tệp không hợp lệ hoặc nội dung không khớp tên, loại và kích thước đã khai báo" });
}

/** Kiểm tên và MIME trước khi dành quota, từ chối đường dẫn và ký tự điều khiển
 * Trả extension chuẩn hóa cho kiểm bytes, tên Unicode tiếng Việt vẫn được giữ cho người đọc
 */
export function checkMetadata(fileName: string, mimeType: string): string {
  const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  if (!fileName.trim() || fileName.length > 180 || /[\\/]/u.test(fileName) || [...fileName].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || FILE_TYPES[extension] !== mimeType) throw invalidFile();
  return extension;
}

/** Kiểm bytes thật sau upload và trước xác nhận để không tin Content-Type hoặc extension
 * DOC phân tích directory OLE, DOCX giới hạn central directory và giải nén trước đọc XML
 * Không chạy macro hoặc gọi bộ chuyển đổi, mọi lỗi thư viện được thay bằng lỗi tiếng Việt
 */
export async function checkFile(bytes: Buffer, fileName: string, mimeType: string, expectedSize: number): Promise<void> {
  const extension = checkMetadata(fileName, mimeType);
  if (bytes.length !== expectedSize || !bytes.length || bytes.length > MAX_FILE_BYTES) throw invalidFile();
  try {
    if (extension === "png") {
      if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0 || bytes.indexOf(Buffer.from("IEND")) < 0) throw invalidFile();
    } else if (["jpg", "jpeg"].includes(extension)) {
      if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw invalidFile();
    } else if (extension === "pdf") {
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || !bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) throw invalidFile();
    } else if (extension === "doc") {
      if (!bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) throw invalidFile();
      const document = CFB.read(bytes, { type: "buffer" });
      const word = document.FileIndex.find((entry) => entry.name === "WordDocument");
      if (!word?.content || word.size < 32 || Buffer.from(word.content).readUInt16LE(0) !== 0xa5ec || document.FullPaths.some((path) => /VBA|Macros|EncryptedPackage/i.test(path))) throw invalidFile();
      // Word 97–2003 chỉ hợp lệ khi có table stream được cờ FIB chỉ định và không mã hóa
      // Không chỉ nhận vỏ OLE vì bảng tính hoặc archive đổi đuôi cũng có cùng chữ ký container
      const flags = Buffer.from(word.content).readUInt16LE(10);
      if ((flags & 0x8100) || !document.FileIndex.some((entry) => entry.name === (flags & 0x0200 ? "1Table" : "0Table") && entry.size > 0)) throw invalidFile();
    } else {
      // Đọc central directory trước JSZip vì chỉ kiểm kích thước nén không ngăn được zip bomb
      // Từ chối ZIP64, mã hóa, đường dẫn lạ và entry trùng để tránh diễn giải archive không thống nhất
      const end = bytes.lastIndexOf(Buffer.from("504b0506", "hex"));
      if (end < 0 || end + 22 > bytes.length) throw invalidFile();
      const count = bytes.readUInt16LE(end + 10);
      let offset = bytes.readUInt32LE(end + 16); let total = 0; let actualTotal = 0;
      const names = new Set<string>();
      if (count === 0 || count > 1000 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw invalidFile();
      for (let index = 0; index < count; index++) {
        if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50 || (bytes.readUInt16LE(offset + 8) & 1)) throw invalidFile();
        const expanded = bytes.readUInt32LE(offset + 24); total += expanded;
        const nameLength = bytes.readUInt16LE(offset + 28);
        const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
        if (total > 40 * 1024 * 1024 || expanded > 20 * 1024 * 1024 || names.has(name) || name.includes("..") || name.includes("\\") || name.startsWith("/") || /vbaProject|macros|EncryptedPackage/i.test(name)) throw invalidFile();
        names.add(name);
        // Giải nén có trần cứng trước JSZip để central directory khai gian không gây phình bộ nhớ
        // Mỗi entry phải khớp kích thước thực và metadata, tổng nội dung không vượt 40 MiB
        const localOffset = bytes.readUInt32LE(offset + 42);
        if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw invalidFile();
        const dataOffset = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
        const compressedSize = bytes.readUInt32LE(offset + 20);
        if (dataOffset + compressedSize > bytes.length) throw invalidFile();
        const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
        const method = bytes.readUInt16LE(offset + 10);
        const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed, { maxOutputLength: 20 * 1024 * 1024 }) : null;
        if (!content || content.length !== expanded) throw invalidFile();
        actualTotal += content.length;
        if (actualTotal > 40 * 1024 * 1024) throw invalidFile();
        offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
      }
      if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) throw invalidFile();
      const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
      const types = await zip.file("[Content_Types].xml")!.async("string");
      const document = await zip.file("word/document.xml")!.async("string");
      if (!types.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") || /macroEnabled|vbaProject/i.test(types) || !/<w:document\b/.test(document)) throw invalidFile();
    }
  } catch { throw invalidFile(); }
}

/** Chuẩn hóa link thuần HTTP/HTTPS và chặn userinfo/ký tự điều khiển, không fetch để tránh SSRF
 * Trả URL chuẩn từ parser, địa chỉ không hợp lệ luôn có mã và câu tiếng Việt ổn định
 */
export function safeExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    if (value.length > 2048 || [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw invalidFile();
    return url.href;
  } catch { throw new UnprocessableEntityException({ code: "INVALID_LINK", message: "Liên kết phải là địa chỉ HTTP hoặc HTTPS hợp lệ, không chứa thông tin đăng nhập" }); }
}
