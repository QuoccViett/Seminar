import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import { Prisma, type ImportSession } from "../../generated/prisma/client.js";
import bcrypt from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AuditService } from "../../common/services/audit.service.js";
import { CredentialDispatchService } from "../notifications/credential-dispatch.service.js";
import { UNIT_TYPES } from "../units/unit-types.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 25 * 1024 * 1024;
const MAX_DATA_ROWS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const HEADERS = ["unitCode", "unitName", "unitType", "username", "fullName", "email", "phone"] as const;
type ImportField = typeof HEADERS[number];
type RowError = { field: string; code: string; message: string };
type ImportRow = Record<ImportField, string> & { rowNumber: number; errors: RowError[] };
type UploadedSpreadsheet = { buffer: Buffer; size: number; originalname: string };

/** Tạo ngoại lệ HTTP dùng mã kỹ thuật ổn định và câu tiếng Việt
 * Đầu vào gồm trạng thái, mã, nội dung và chi tiết đã lọc; đầu ra không bao giờ kèm lỗi Prisma, SQL hoặc provider
 * Lỗi xung đột dùng 409, còn cấu trúc file và điều kiện nghiệp vụ dùng 422 theo contract
 */
function importError(status: number, code: string, message: string, details: unknown[] = []) {
  if (status === 409) return new ConflictException({ statusCode: status, code, message, details });
  return new UnprocessableEntityException({ statusCode: status, code, message, details });
}

/** Kiểm tra cấu trúc ZIP trước khi thư viện bảng tính giải nén nội dung
 * Đầu vào là byte XLSX đã bị giới hạn kích thước nén; đầu ra là chấp nhận hoặc lỗi tiếng Việt an toàn
 * Từ chối ZIP mã hóa, ZIP64, macro, liên kết ngoài, kích thước khai báo sai và dữ liệu thực giải nén vượt 25 MiB
 * Giải nén từng thành phần có giới hạn nhằm bảo vệ tiến trình khỏi tệp nén phình bất thường
 */
function inspectXlsxArchive(buffer: Buffer): void {
  let footer = -1;
  for (let offset = Math.max(0, buffer.length - 65_557); offset <= buffer.length - 22; offset += 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) footer = offset;
  }
  if (footer < 0) throw importError(422, "INVALID_XLSX", "Tệp Excel bị hỏng hoặc không đúng định dạng XLSX.");
  const entries = buffer.readUInt16LE(footer + 10);
  const diskEntries = buffer.readUInt16LE(footer + 8);
  const diskNumber = buffer.readUInt16LE(footer + 4);
  const directorySize = buffer.readUInt32LE(footer + 12);
  const directoryOffset = buffer.readUInt32LE(footer + 16);
  if (!entries || entries > 200 || diskEntries !== entries || diskNumber !== 0 || directoryOffset + directorySize > footer) throw importError(422, "INVALID_XLSX", "Cấu trúc tệp Excel không hợp lệ hoặc có quá nhiều thành phần.");
  let offset = directoryOffset;
  let expandedSize = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw importError(422, "INVALID_XLSX", "Danh mục thành phần trong tệp Excel không hợp lệ.");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const expanded = buffer.readUInt32LE(offset + 24);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    if ((flags & 1) !== 0) throw importError(422, "ENCRYPTED_XLSX", "Tệp Excel có đặt mật khẩu hoặc mã hóa nên không thể nhập.");
    if (![0, 8].includes(method) || compressed === 0xffffffff || expanded === 0xffffffff) throw importError(422, "INVALID_XLSX", "Tệp Excel dùng kiểu nén không được hỗ trợ.");
    if (expanded > MAX_EXPANDED_BYTES || compressed > MAX_FILE_BYTES) throw importError(422, "XLSX_EXPANDED_TOO_LARGE", "Kích thước tệp sau giải nén vượt quá giới hạn 25 MiB.");
    const nameStart = offset + 46;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    if (/vbaproject\.bin|externalLinks/i.test(name)) throw importError(422, "MACRO_NOT_ALLOWED", "Tệp Excel có macro hoặc liên kết ngoài không được phép.");
    if (localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw importError(422, "INVALID_XLSX", "Tệp Excel có mục dữ liệu không hợp lệ.");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressed > directoryOffset) throw importError(422, "INVALID_XLSX", "Tệp Excel có vùng dữ liệu vượt khỏi cấu trúc ZIP.");
    const compressedData = buffer.subarray(dataStart, dataStart + compressed);
    let actualSize: number;
    try {
      actualSize = method === 0 ? compressedData.length : inflateRawSync(compressedData, { maxOutputLength: Math.max(1, MAX_EXPANDED_BYTES - expandedSize) }).length;
    } catch {
      throw importError(422, "XLSX_EXPANDED_TOO_LARGE", "Tệp Excel bị hỏng hoặc vượt quá giới hạn sau giải nén.");
    }
    if (actualSize !== expanded) throw importError(422, "INVALID_XLSX", "Kích thước thành phần trong tệp Excel không nhất quán.");
    expandedSize += actualSize;
    offset = nameStart + nameLength + extraLength + commentLength;
    if (offset > directoryOffset + directorySize || expandedSize > MAX_EXPANDED_BYTES) throw importError(422, "XLSX_EXPANDED_TOO_LARGE", "Kích thước tệp sau giải nén vượt quá giới hạn 25 MiB.");
  }
}

/** Đọc một ô thành chuỗi đã cắt khoảng trắng và kiểm tra kiểu dữ liệu
 * Đầu vào là giá trị Excel cùng số dòng/tên cột; đầu ra là văn bản thuần rỗng hoặc đã chuẩn hóa
 * Từ chối công thức, rich-text, số và nội dung dài để không thực thi biểu thức hoặc làm mất số 0 đầu
 */
function readTextCell(value: ExcelJS.CellValue, rowNumber: number, field: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) throw importError(422, "FORMULA_NOT_ALLOWED", `Ô ${field} tại dòng ${rowNumber} có công thức không được phép.`);
    throw importError(422, "INVALID_CELL", `Ô ${field} tại dòng ${rowNumber} phải là văn bản thuần.`);
  }
  if (typeof value !== "string") throw importError(422, "INVALID_CELL", `Ô ${field} tại dòng ${rowNumber} phải được nhập dưới dạng văn bản.`);
  const text = value.trim();
  if (text.length > 200) throw importError(422, "CELL_TOO_LONG", `Ô ${field} tại dòng ${rowNumber} vượt quá 200 ký tự.`);
  return text;
}

/** Kiểm tra quy tắc hồ sơ UNIT trên một dòng đã đọc từ file
 * Đầu vào là dòng có vị trí Excel và các cột chuỗi; đầu ra là danh sách lỗi field/code/message gắn trực tiếp trên dòng
 * Email bắt buộc vì các kênh onboarding cần địa chỉ nhận, còn phone được lưu như văn bản và không mở ZNS
 */
function validateRow(row: ImportRow): void {
  const add = (field: ImportField, code: string, message: string) => row.errors.push({ field, code, message });
  for (const field of ["unitCode", "unitName", "unitType", "username", "fullName", "email"] as const) {
    if (!row[field]) add(field, "REQUIRED", `${field} là bắt buộc.`);
  }
  if (row.unitCode.length > 64) add("unitCode", "INVALID_LENGTH", "Mã đơn vị tối đa 64 ký tự.");
  if (row.unitName.length > 200) add("unitName", "INVALID_LENGTH", "Tên đơn vị tối đa 200 ký tự.");
  if (row.unitType.length > 64) add("unitType", "INVALID_LENGTH", "Loại đơn vị tối đa 64 ký tự.");
  if (!(UNIT_TYPES as readonly string[]).includes(row.unitType)) add("unitType", "INVALID_UNIT_TYPE", "Loại đơn vị không hợp lệ; hãy chọn một giá trị trong danh sách ở tệp mẫu.");
  row.username = row.username.toLowerCase();
  if (row.username.length < 3 || row.username.length > 64 || !/^[a-z0-9._-]+$/.test(row.username)) add("username", "INVALID_USERNAME", "Tên đăng nhập phải từ 3 đến 64 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.");
  if (row.fullName.length > 255) add("fullName", "INVALID_LENGTH", "Họ và tên tối đa 255 ký tự.");
  row.email = row.email.toLowerCase();
  if (row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) add("email", "INVALID_EMAIL", "Email không hợp lệ; cần email để gửi thông tin đăng nhập.");
  if (row.phone && !/^\+?[0-9]{9,15}$/.test(row.phone)) add("phone", "INVALID_PHONE", "Số điện thoại phải có 9 đến 15 chữ số và có thể bắt đầu bằng dấu +.");
}

@Injectable()
export class UserImportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UserImportService.name);
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CredentialDispatchService) private readonly credentials: CredentialDispatchService,
  ) {}

  /** Lên lịch xóa các phiên quá hạn để dữ liệu email/điện thoại trong preview không lưu lâu hơn TTL
   * Lần dọn chạy ngay khi module khởi động rồi lặp mỗi 15 phút; lỗi chỉ ghi câu chung và lượt sau sẽ thử lại
   */
  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => { void this.purgeExpiredSessions().catch(() => this.logger.error("Không thể dọn phiên nhập đã hết hạn; hệ thống sẽ thử lại")); }, 15 * 60 * 1000);
    this.cleanupTimer.unref?.();
    void this.purgeExpiredSessions().catch(() => this.logger.error("Không thể dọn phiên nhập đã hết hạn; hệ thống sẽ thử lại"));
  }

  /** Dừng timer khi Nest đóng để tiến trình kiểm thử hoặc triển khai có thể thoát sạch */
  onModuleDestroy(): void { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  /** Xóa các phiên cũ dựa trên thời gian server, không xóa phiên còn trong cửa sổ xác nhận */
  private async purgeExpiredSessions(): Promise<number> {
    const result = await this.prisma.importSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    return result.count;
  }

  /** Tạo workbook XLSX dùng làm mẫu đầu vào của màn Import
   * Không nhận dữ liệu từ client; trả byte XLSX với header đúng thứ tự và ví dụ phone dạng văn bản
   * Một dòng ví dụ giúp người dùng nhận diện định dạng, nhưng chỉ được tạo tài khoản sau bước xác nhận riêng
   */
  async createTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Import UNIT");
    sheet.addRow([...HEADERS]);
    sheet.getRow(1).font = { bold: true };
    sheet.addRow(["COSO01", "Đoàn cơ sở mẫu", "DON_VI_TRUC_THUOC", "coso01", "Đoàn cơ sở mẫu", "coso01@example.com", "0900000001"]);
    sheet.getCell("G2").numFmt = "@";
    sheet.columns = HEADERS.map((header) => ({ header, width: Math.max(header.length + 4, 20) }));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Phân tích file trong bộ nhớ và trả dòng chuẩn hóa để preview mà chưa tạo bản ghi nghiệp vụ
   * Đầu vào là file Multer có tên, kích thước và buffer; đầu ra là tối đa 100 dòng kèm lỗi từng cột
   * Kiểm chữ ký, giới hạn giải nén, sheet, header, kiểu ô, formula và độ dài trước khi trả dữ liệu
   * Bỏ dòng trắng hoàn toàn, nhưng từ chối workbook rỗng, sheet thừa, tiêu đề sai hoặc nội dung không đọc được
   */
  async parse(file: UploadedSpreadsheet): Promise<ImportRow[]> {
    if (!file?.buffer?.length) throw importError(422, "EMPTY_FILE", "Tệp Excel đang trống.");
    if (file.size > MAX_FILE_BYTES) throw importError(422, "FILE_TOO_LARGE", "Tệp Excel vượt quá giới hạn 5 MiB.");
    if (!/\.xlsx$/i.test(file.originalname) || file.buffer.length < 4 || file.buffer.readUInt32LE(0) !== 0x04034b50) throw importError(422, "INVALID_XLSX", "Chỉ chấp nhận tệp XLSX hợp lệ.");
    inspectXlsxArchive(file.buffer);
    try {
      const workbook = new ExcelJS.Workbook();
      const workbookBuffer = Buffer.alloc(file.buffer.length);
      workbookBuffer.set(file.buffer);
      await workbook.xlsx.load(workbookBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      if (workbook.worksheets.length !== 1) throw importError(422, "INVALID_SHEET_COUNT", "Tệp Excel phải có đúng một trang tính.");
      const sheet = workbook.worksheets[0]!;
      if (sheet.rowCount < 2) throw importError(422, "EMPTY_ROWS", "Tệp Excel chưa có dòng dữ liệu nào.");
      if (sheet.rowCount > MAX_DATA_ROWS + 1) throw importError(422, "TOO_MANY_ROWS", "Tệp Excel vượt quá giới hạn 100 dòng dữ liệu.");
      const actualHeaders = HEADERS.map((_, index) => readTextCell(sheet.getRow(1).getCell(index + 1).value, 1, `header${index + 1}`));
      if (actualHeaders.length !== HEADERS.length || actualHeaders.some((value, index) => value !== HEADERS[index]) || sheet.getRow(1).cellCount !== HEADERS.length) throw importError(422, "INVALID_HEADERS", "Tiêu đề cột phải đúng thứ tự: unitCode, unitName, unitType, username, fullName, email, phone.");
      const rows: ImportRow[] = [];
      sheet.eachRow((excelRow, rowNumber) => {
        if (rowNumber === 1) return;
        if (excelRow.cellCount > HEADERS.length) throw importError(422, "INVALID_COLUMNS", `Dòng ${rowNumber} có cột ngoài mẫu cho phép.`);
        const values = HEADERS.map((header, index) => readTextCell(excelRow.getCell(index + 1).value, rowNumber, header));
        if (values.every((value) => !value)) return;
        if (rows.length >= MAX_DATA_ROWS) throw importError(422, "TOO_MANY_ROWS", "Tệp Excel vượt quá giới hạn 100 dòng dữ liệu.");
        const row = Object.assign({ rowNumber, errors: [] as RowError[] }, Object.fromEntries(HEADERS.map((header, index) => [header, values[index]]))) as unknown as ImportRow;
        validateRow(row);
        rows.push(row);
      });
      if (!rows.length) throw importError(422, "EMPTY_ROWS", "Tệp Excel chưa có dòng dữ liệu nào.");
      this.markDuplicates(rows, "unitCode", "DUPLICATE_UNIT_CODE", "Mã đơn vị bị lặp trong tệp.");
      this.markDuplicates(rows, "username", "DUPLICATE_USERNAME", "Tên đăng nhập bị lặp trong tệp.");
      this.markDuplicates(rows, "email", "DUPLICATE_EMAIL", "Email bị lặp trong tệp.");
      return rows;
    } catch (error) {
      if (error instanceof UnprocessableEntityException || error instanceof ConflictException) throw error;
      throw importError(422, "INVALID_XLSX", "Không thể đọc tệp Excel; hãy tải mẫu mới và kiểm tra nội dung.");
    }
  }

  /** Gắn lỗi trùng lên mọi dòng cùng giá trị chuẩn hóa
   * Đầu vào là danh sách dòng, cột định danh và mã/câu lỗi; cập nhật tại chỗ, không chọn dòng đầu làm bản ghi thắng
   * So sánh không phân biệt hoa thường cho mã đơn vị, username và email trước khi confirm
   */
  private markDuplicates(rows: ImportRow[], field: "unitCode" | "username" | "email", code: string, message: string): void {
    const grouped = new Map<string, ImportRow[]>();
    for (const row of rows) {
      const value = row[field].toLowerCase();
      if (!value) continue;
      grouped.set(value, [...(grouped.get(value) ?? []), row]);
    }
    for (const duplicates of grouped.values()) if (duplicates.length > 1) for (const row of duplicates) row.errors.push({ field, code, message });
  }

  /** Đối chiếu username, email và Unit hiện có để preview báo xung đột trước bước tạo dữ liệu
   * Đầu vào là các dòng đã kiểm tra cú pháp; truy vấn chỉ đọc theo tập giá trị phân biệt
   * Gắn lỗi khi thông tin Unit lệch, Unit khóa/đã có user hoặc username/email đã dùng; không sửa dữ liệu cũ
   */
  private async validateAgainstDatabase(rows: ImportRow[]): Promise<void> {
    const codes = [...new Set(rows.map((row) => row.unitCode).filter(Boolean))];
    const usernames = [...new Set(rows.map((row) => row.username).filter(Boolean))];
    const emails = [...new Set(rows.map((row) => row.email).filter(Boolean))];
    const [units, usernameMatches, emailMatches] = await Promise.all([
      this.prisma.unit.findMany({ where: { code: { in: codes } }, select: { code: true, name: true, unitType: true, isActive: true, user: { select: { id: true } } } }),
      this.prisma.user.findMany({ where: { username: { in: usernames, mode: "insensitive" } }, select: { username: true } }),
      this.prisma.user.findMany({ where: { email: { in: emails, mode: "insensitive" } }, select: { email: true } }),
    ]);
    const unitsByCode = new Map(units.map((unit) => [unit.code.toLowerCase(), unit]));
    const knownUsernames = new Set(usernameMatches.map((user) => user.username.toLowerCase()));
    const knownEmails = new Set(emailMatches.map((user) => user.email?.toLowerCase()).filter(Boolean));
    for (const row of rows) {
      const unit = unitsByCode.get(row.unitCode.toLowerCase());
      const add = (field: string, code: string, message: string) => row.errors.push({ field, code, message });
      if (unit) {
        if (unit.name !== row.unitName || unit.unitType !== row.unitType) add("unitCode", "UNIT_MISMATCH", "Đơn vị đã có nhưng tên hoặc loại không khớp; hệ thống không tự ghi đè.");
        if (!unit.isActive) add("unitCode", "UNIT_INACTIVE", "Đơn vị hiện có đang bị khóa.");
        if (unit.user) add("unitCode", "UNIT_ACCOUNT_EXISTS", "Đơn vị hiện có đã được gắn tài khoản.");
      }
      if (knownUsernames.has(row.username)) add("username", "DUPLICATE_USERNAME", "Tên đăng nhập đã tồn tại trong hệ thống.");
      if (knownEmails.has(row.email)) add("email", "DUPLICATE_EMAIL", "Email đã được sử dụng trong hệ thống.");
    }
  }

  /** Tạo hoặc đọc lại phiên preview thuộc Admin gọi API
   * Đầu vào là file, ID Admin từ access token và Idempotency-Key; đầu ra là bản preview có TTL 30 phút
   * Digest SHA-256 phân biệt file retry; cùng khóa với file khác trả 409, còn cùng khóa/file trả phiên cũ
   * Rows đã chuẩn hóa và lỗi được lưu JSON, không lưu workbook, password hoặc payload gửi tin
   */
  async preview(file: UploadedSpreadsheet, adminId: string, idempotencyKey: string) {
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length < 1 || idempotencyKey.length > 200) throw importError(422, "VALIDATION_ERROR", "Idempotency-Key phải có từ 1 đến 200 ký tự.", [{ field: "Idempotency-Key", messages: ["Idempotency-Key phải có từ 1 đến 200 ký tự."] }]);
    if (!file?.buffer?.length) throw importError(422, "EMPTY_FILE", "Tệp Excel đang trống.");
    const digest = createHash("sha256").update(file.buffer).digest("hex");
    const previous = await this.prisma.importSession.findUnique({ where: { adminId_idempotencyKey: { adminId, idempotencyKey: idempotencyKey.trim() } } });
    if (previous && previous.expiresAt > new Date()) {
      if (previous.fileDigest !== digest) throw importError(409, "IDEMPOTENCY_KEY_REUSED", "Khóa chống tạo lặp đã được dùng cho một tệp khác.");
      return this.toPreview(previous);
    }
    const rows = await this.parse(file);
    await this.validateAgainstDatabase(rows);
    if (previous) await this.prisma.importSession.delete({ where: { id: previous.id } });
    const now = new Date();
    const session = await this.prisma.importSession.create({ data: { id: randomUUID(), adminId, fileDigest: digest, rows: rows as unknown as Prisma.InputJsonValue, status: "PREVIEWED", idempotencyKey: idempotencyKey.trim(), expiresAt: new Date(now.getTime() + SESSION_TTL_MS), createdAt: now, updatedAt: now } });
    return this.toPreview(session);
  }

  /** Chuyển một ImportSession thành DTO preview công khai
   * Đầu vào là phiên đã lưu; đầu ra chỉ có số dòng, hạn và dữ liệu chuẩn hóa phục vụ bảng FE
   * Digest, owner, file bytes, trạng thái nội bộ và thông tin bí mật không nằm trong phản hồi
   */
  private toPreview(session: ImportSession) {
    const rows = session.rows as unknown as ImportRow[];
    return { importId: session.id, expiresAt: session.expiresAt, totalRows: rows.length, validRows: rows.filter((row) => row.errors.length === 0).length, invalidRows: rows.filter((row) => row.errors.length > 0).length, rows };
  }

  /** Tạo toàn bộ Unit/User và delivery từ phiên preview trong một transaction
   * Đầu vào là UUID phiên cùng Admin lấy từ token; đầu ra là kết quả đã lưu để lần gọi lặp không tạo bản ghi mới
   * Khóa phiên, khóa advisory theo các định danh, kiểm lại owner/TTL/dữ liệu và từ chối toàn lô nếu có lỗi
   * Unit cũ chỉ được liên kết khi active, chưa có user và tên/loại trùng; không ghi đè Unit hoặc username/email
   * Hash mật khẩu, audit và payload dispatch mã hóa cùng transaction; worker chỉ gửi sau commit
   */
  async confirm(importId: string, adminId: string) {
    const preview = await this.prisma.importSession.findUnique({ where: { id: importId } });
    if (!preview || preview.adminId !== adminId) throw new NotFoundException({ code: "IMPORT_SESSION_NOT_FOUND", message: "Không tìm thấy phiên nhập dữ liệu.", details: [] });
    if (preview.expiresAt <= new Date()) throw importError(422, "IMPORT_SESSION_EXPIRED", "Phiên xem trước đã hết hạn; hãy tải tệp lên để xem trước lại.");
    if (preview.status === "CONFIRMED" && preview.result) return preview.result;
    const previewRows = preview.rows as unknown as ImportRow[];
    const invalidPreviewRows = previewRows.filter((row) => row.errors.length > 0);
    if (invalidPreviewRows.length) throw importError(422, "IMPORT_VALIDATION_FAILED", "Tệp còn lỗi; hãy sửa các dòng được nêu trước khi xác nhận.", invalidPreviewRows.flatMap((row) => row.errors.map((item) => ({ field: `rows[${row.rowNumber}].${item.field}`, messages: [item.message] }))));
    const initialPassword = this.config.get<string>("INITIAL_ACCOUNT_PASSWORD") ?? "123456";
    // Mỗi tài khoản nhận salt bcrypt riêng; băm ngoài transaction để không giữ khóa DB trong lúc CPU xử lý
    const passwordHashes = await Promise.all(previewRows.map(async (row) => [row.rowNumber, await bcrypt.hash(initialPassword, BCRYPT_ROUNDS)] as const));
    const passwordHashByRow = new Map(passwordHashes);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`import-session:${importId}`}, 0))`;
        const session = await tx.importSession.findUnique({ where: { id: importId } });
        if (!session || session.adminId !== adminId) throw new NotFoundException({ code: "IMPORT_SESSION_NOT_FOUND", message: "Không tìm thấy phiên nhập dữ liệu.", details: [] });
        if (session.expiresAt <= new Date()) {
          await tx.importSession.update({ where: { id: session.id }, data: { status: "EXPIRED", updatedAt: new Date() } });
          throw importError(422, "IMPORT_SESSION_EXPIRED", "Phiên xem trước đã hết hạn; hãy tải tệp lên để xem trước lại.");
        }
        if (session.status === "CONFIRMED" && session.result) return session.result;
        const rows = session.rows as unknown as ImportRow[];
        const invalid = rows.filter((row) => row.errors.length > 0);
        if (invalid.length) throw importError(422, "IMPORT_VALIDATION_FAILED", "Tệp còn lỗi; hãy sửa các dòng được nêu trước khi xác nhận.", invalid.flatMap((row) => row.errors.map((item) => ({ field: `rows[${row.rowNumber}].${item.field}`, messages: [item.message] }))));
        const lockKeys = [...new Set(rows.flatMap((row) => [`unit:${row.unitCode.toLowerCase()}`, `username:${row.username.toLowerCase()}`, `email:${row.email.toLowerCase()}`]))].sort();
        for (const key of lockKeys) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const codes = [...new Set(rows.map((row) => row.unitCode))];
        const usernames = [...new Set(rows.map((row) => row.username))];
        const emails = [...new Set(rows.map((row) => row.email))];
        for (const code of [...codes].sort()) await tx.$executeRaw`SELECT 1 FROM units WHERE code = ${code} FOR UPDATE`;
        const [units, users] = await Promise.all([
          tx.unit.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, name: true, unitType: true, isActive: true, user: { select: { id: true } } } }),
          tx.user.findMany({ where: { OR: [{ username: { in: usernames, mode: "insensitive" } }, { email: { in: emails, mode: "insensitive" } }] }, select: { username: true, email: true } }),
        ]);
        const unitsByCode = new Map(units.map((unit) => [unit.code.toLowerCase(), unit]));
        const existingUsernames = new Set(users.map((user) => user.username.toLowerCase()));
        const existingEmails = new Set(users.map((user) => user.email?.toLowerCase()).filter(Boolean));
        const errors: Array<{ rowNumber: number; errors: RowError[] }> = [];
        for (const row of rows) {
          const rowErrors: RowError[] = [];
          const unit = unitsByCode.get(row.unitCode.toLowerCase());
          if (unit && (unit.name !== row.unitName || unit.unitType !== row.unitType || !unit.isActive || unit.user)) rowErrors.push({ field: "unitCode", code: unit.user ? "UNIT_ACCOUNT_EXISTS" : !unit.isActive ? "UNIT_INACTIVE" : "UNIT_MISMATCH", message: "Đơn vị đã thay đổi hoặc không còn đủ điều kiện; hãy xem trước lại tệp." });
          if (existingUsernames.has(row.username.toLowerCase())) rowErrors.push({ field: "username", code: "DUPLICATE_USERNAME", message: "Tên đăng nhập vừa được tạo hoặc đã tồn tại trong hệ thống." });
          if (existingEmails.has(row.email.toLowerCase())) rowErrors.push({ field: "email", code: "DUPLICATE_EMAIL", message: "Email vừa được sử dụng hoặc đã tồn tại trong hệ thống." });
          if (rowErrors.length) errors.push({ rowNumber: row.rowNumber, errors: rowErrors });
        }
        if (errors.length) throw importError(422, "IMPORT_VALIDATION_FAILED", "Dữ liệu đã thay đổi kể từ lúc xem trước; không có tài khoản nào được tạo.", errors.flatMap((row) => row.errors.map((item) => ({ field: `rows[${row.rowNumber}].${item.field}`, messages: [item.message] }))));

        const now = new Date();
        const accounts: Array<Record<string, unknown>> = [];
        let unitsCreated = 0;
        for (const row of rows) {
          let unit = unitsByCode.get(row.unitCode.toLowerCase());
          if (!unit) {
            unit = await tx.unit.create({ data: { id: randomUUID(), code: row.unitCode, name: row.unitName, unitType: row.unitType, sortOrder: 0, isActive: true, createdAt: now, updatedAt: now }, select: { id: true, code: true, name: true, unitType: true, isActive: true, user: { select: { id: true } } } });
            unitsByCode.set(row.unitCode.toLowerCase(), unit);
            unitsCreated += 1;
          }
          const user = await tx.user.create({ data: { id: randomUUID(), username: row.username, passwordHash: passwordHashByRow.get(row.rowNumber)!, mustChangePassword: true, fullName: row.fullName, email: row.email, phone: row.phone || null, role: "UNIT", unitId: unit.id, isActive: true, credentialVersion: 0, createdAt: now, updatedAt: now }, select: { id: true, username: true } });
          const queued = await this.credentials.enqueue(tx, { userId: user.id, version: 0, username: row.username, password: initialPassword, email: row.email });
          const credentialStatus = queued ? "QUEUED" : "NOT_CONFIGURED";
          await this.audit.record({ actorId: adminId, action: "USER_IMPORTED", entity: "User", entityId: user.id, after: { username: user.username, role: "UNIT", unitId: unit.id, importSessionId: session.id } }, tx);
          accounts.push({ rowNumber: row.rowNumber, userId: user.id, username: user.username, email: row.email, unitCode: unit.code, credentialStatus, channels: queued ? await this.currentChannels(tx, user.id) : [] });
        }
        if (unitsCreated) await this.audit.record({ actorId: adminId, action: "UNITS_IMPORTED", entity: "ImportSession", entityId: session.id, after: { count: unitsCreated } }, tx);
        const result = { importId: session.id, status: "CONFIRMED", createdCount: accounts.length, unitsCreated, accounts };
        await tx.importSession.update({ where: { id: session.id }, data: { status: "CONFIRMED", confirmedAt: now, result: result as unknown as Prisma.InputJsonValue, updatedAt: now } });
        return result;
      }, { timeout: 30000, maxWait: 10000 });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnprocessableEntityException || error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw importError(422, "IMPORT_VALIDATION_FAILED", "Dữ liệu vừa được một thao tác khác sử dụng; không có phần nhập nào được xác nhận.");
      throw error;
    }
  }

  /** Đọc trạng thái delivery vừa xếp để FE hiển thị ba kênh theo từng tài khoản
   * Đầu vào là transaction đang tạo user; đầu ra chỉ có tên kênh, status, errorCode, số lần thử và sentAt
   * Không trả ciphertext, token mời, mật khẩu hoặc thông tin cấu hình provider
   */
  private async currentChannels(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { credentialVersion: true } });
    const dispatch = user ? await tx.credentialDispatch.findUnique({ where: { userId_credentialVersion: { userId, credentialVersion: user.credentialVersion } }, select: { deliveries: { select: { channel: true, status: true, errorCode: true, attemptCount: true, sentAt: true }, orderBy: { channel: "asc" } } } }) : null;
    return dispatch?.deliveries ?? [];
  }
}
