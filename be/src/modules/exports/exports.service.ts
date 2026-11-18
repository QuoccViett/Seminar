import { BadRequestException, ForbiddenException, Inject, Injectable, InternalServerErrorException, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AuditService } from "../../common/services/audit.service.js";
import { buildPaginationOptions, createPaginatedResult } from "../../common/utils/pagination.util.js";
import type { CreateReportExportDto, ReportFormat } from "./dto/create-report-export.dto.js";
import type { ReportExportQueryDto } from "./dto/report-export-query.dto.js";
import { ExcelReportGenerator } from "./generators/excel.generator.js";
import { PdfReportGenerator } from "./generators/pdf.generator.js";
import { WordReportGenerator } from "./generators/word.generator.js";
import { ReportSnapshotService } from "./report-snapshot.service.js";
import { ReportStorageService } from "./report-storage.service.js";

type ExportRecord = {
  id: string; periodId: string; evaluationId: string | null; reportType: string; format: string;
  fileName: string | null; sizeBytes: bigint | null; createdById: string; createdAt: Date;
};

/** Điều phối snapshot, generator, kho private và metadata/audit của lần xuất đồng bộ
 * Không tạo bản ghi thành công trước khi bytes được lưu và không phát thông báo ra provider
 */
@Injectable()
export class ExportsService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** Tiêm các thành phần tách biệt để kiểm lỗi storage, chữ ký và rollback mà không giả luồng HTTP */
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ExcelReportGenerator) private readonly excel: ExcelReportGenerator,
    @Inject(PdfReportGenerator) private readonly pdf: PdfReportGenerator,
    @Inject(WordReportGenerator) private readonly word: WordReportGenerator,
    @Inject(ReportSnapshotService) private readonly snapshot: ReportSnapshotService,
    @Inject(ReportStorageService) private readonly storage: ReportStorageService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  /** Dọn sau khởi động và mỗi giờ để phục hồi tệp mồ côi sau crash hoặc lỗi bù xóa
   * Timer không giữ tiến trình sống và lỗi dọn không làm hỏng một lần xuất hợp lệ
   */
  onModuleInit(): void {
    void this.cleanupOrphans().catch(() => undefined);
    this.cleanupTimer = setInterval(() => { void this.cleanupOrphans().catch(() => undefined); }, 3600000);
    this.cleanupTimer.unref();
  }

  /** Dừng lịch khi Nest đóng để không truy vấn sau khi Prisma đã ngắt kết nối */
  onModuleDestroy(): void { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  /** Kiểm từng key cũ trên DB trước xóa, hỗ trợ bản ghi trước đây dùng dấu phân cách Windows
   * Khi DB hỏng callback ném lỗi và storage giữ tệp để lần sau kiểm lại
   */
  async cleanupOrphans(now = new Date()): Promise<number> {
    return this.storage.cleanup(async (key) => Boolean(await this.prisma.reportExport.findFirst({ where: { storagePath: { in: [key, key.replaceAll("/", "\\")] } }, select: { id: true } })), now);
  }

  /** Tạo tệp hoàn chỉnh từ snapshot, lưu private rồi commit metadata và audit cùng transaction
   * Scope sai bị chặn trước khi đọc dữ liệu; lỗi generator không trả raw provider hoặc thư viện
   * Khi transaction lỗi sẽ bù xóa, nếu bù cũng lỗi bộ dọn theo tuổi tệp tiếp tục xử lý
   */
  async create(actorId: string, dto: CreateReportExportDto) {
    this.validateScope(dto);
    const snapshot = await this.snapshot.read(dto, actorId);
    let generated;
    try {
      generated = snapshot.type === "summary" ? await this.excel.generateSummary(snapshot.data)
        : dto.format === "PDF" ? await this.pdf.generateAppraisal(snapshot.data) : await this.word.generateAppraisal(snapshot.data);
      if (!generated.buffer.length || generated.buffer.length > 32 * 1024 * 1024) throw new Error("Dung lượng báo cáo không hợp lệ");
    } catch { throw new InternalServerErrorException({ code: "INTERNAL_ERROR", message: "Không thể tạo nội dung báo cáo" }); }
    const id = randomUUID();
    const prefix = dto.reportType === "SUMMARY_ALL_UNITS" ? "summary-all-units" : "unit-appraisal-minutes";
    const fileName = `${prefix}-${snapshot.data.period.year}.${generated.extension}`;
    const key = `${dto.periodId}/${id}-${fileName}`;
    await this.storage.put(key, generated.buffer);
    let record: ExportRecord;
    try {
      record = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.reportExport.create({ data: { id, periodId: dto.periodId, evaluationId: dto.evaluationId ?? null, reportType: dto.reportType, format: dto.format, storagePath: key, fileName, sizeBytes: BigInt(generated.buffer.length), createdById: actorId, createdAt: snapshot.data.period.generatedAt } });
        await this.audit.record({ actorId, action: "REPORT_EXPORTED", entity: "ReportExport", entityId: id, after: { periodId: dto.periodId, evaluationId: dto.evaluationId ?? null, reportType: dto.reportType, format: dto.format, fileName, sizeBytes: generated.buffer.length } }, tx);
        return saved;
      });
    } catch {
      await this.storage.remove(key).catch(() => undefined);
      throw new InternalServerErrorException({ code: "INTERNAL_ERROR", message: "Không thể lưu thông tin báo cáo vừa tạo" });
    }
    return this.metadata(record, actorId);
  }

  /** Áp quy tắc loại/định dạng và evaluationId cho cả controller lẫn caller nội bộ
   * Không dùng IsOptional để bỏ qua null của trường bắt buộc theo loại báo cáo
   */
  private validateScope(dto: CreateReportExportDto): void {
    if (!["SUMMARY_ALL_UNITS", "UNIT_APPRAISAL_MINUTES"].includes(dto.reportType) ||
      (dto.reportType === "SUMMARY_ALL_UNITS" && dto.format !== "XLSX") ||
      (dto.reportType === "UNIT_APPRAISAL_MINUTES" && !["PDF", "DOCX"].includes(dto.format))) {
      throw new BadRequestException({ code: "BUSINESS_RULE_VIOLATION", message: "Định dạng không phù hợp với loại báo cáo đã chọn" });
    }
    if (dto.reportType === "SUMMARY_ALL_UNITS" && dto.evaluationId !== undefined) throw new BadRequestException({ code: "BUSINESS_RULE_VIOLATION", message: "Báo cáo tổng hợp không được gắn với mã hồ sơ" });
    if (dto.reportType === "UNIT_APPRAISAL_MINUTES" && !dto.evaluationId) throw new BadRequestException({ code: "BUSINESS_RULE_VIOLATION", message: "Biên bản thẩm định cần mã hồ sơ thuộc kỳ đã chọn" });
  }

  /** Lọc và phân trang lịch sử trong một snapshot, ký URL cho chính quản trị viên đang yêu cầu
   * Sắp xếp phụ bằng ID giữ thứ tự ổn định, không đưa storagePath vào kết quả
   */
  async findAll(query: ReportExportQueryDto, actorId: string) {
    const where = { ...(query.periodId && { periodId: query.periodId }), ...(query.evaluationId && { evaluationId: query.evaluationId }), ...(query.reportType && { reportType: query.reportType }), ...(query.format && { format: query.format }) };
    const { skip, take, orderBy } = buildPaginationOptions(query, ["createdAt"]);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.reportExport.findMany({ where, orderBy, skip, take }),
      this.prisma.reportExport.count({ where }),
    ], { isolationLevel: "RepeatableRead" });
    return createPaginatedResult(items.map((item) => this.metadata(item, actorId)), total, query.page, query.pageSize);
  }

  /** Cấp lại URL ngắn hạn khi người dùng tải muộn, không thay file hoặc metadata đã xuất */
  async findOne(id: string, actorId: string) { return this.metadata(await this.record(id), actorId); }

  /** Xác minh chữ ký có mục đích riêng và ràng buộc người dùng/mã báo cáo trước khi đọc bytes
   * Guard vẫn xác thực ADMIN đang hoạt động, URL không tự cấp quyền hoặc sống quá thời hạn token
   * Audit tải chỉ ghi mã báo cáo và định dạng, tuyệt đối không ghi token hoặc đường dẫn
   */
  async getDownload(id: string, actorId: string, token: string) {
    try {
      const claims = this.jwt.verify<{ purpose: string; sub: string; reportId: string }>(token, { algorithms: ["HS256"], audience: "seminar-report-download" });
      if (claims.purpose !== "REPORT_DOWNLOAD" || claims.sub !== actorId || claims.reportId !== id) throw new Error("Phạm vi tải không hợp lệ");
    } catch { throw new ForbiddenException({ code: "FORBIDDEN", message: "Liên kết tải báo cáo không hợp lệ hoặc đã hết hạn, vui lòng lấy liên kết mới" }); }
    const record = await this.record(id);
    const buffer = await this.storage.get(record.storagePath);
    await this.audit.record({ actorId, action: "REPORT_DOWNLOADED", entity: "ReportExport", entityId: id, after: { format: record.format } });
    return { buffer, fileName: record.fileName ?? `bao-cao.${record.format.toLowerCase()}`, contentType: this.contentType(record.format as ReportFormat) };
  }

  /** Tìm bản ghi duy nhất và chuẩn hóa trường hợp không có lịch sử xuất */
  private async record(id: string) {
    const record = await this.prisma.reportExport.findUnique({ where: { id } });
    if (!record) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy lịch sử xuất báo cáo" });
    return record;
  }

  /** Chiếu metadata an toàn và URL ký riêng cho người đọc, kiểm BigInt trước khi chuyển số
   * Thời hạn được tính ở server và token có audience riêng để không dùng thay access token
   */
  private metadata(record: ExportRecord, actorId: string) {
    if (record.sizeBytes !== null && (record.sizeBytes < 0n || record.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER))) throw new InternalServerErrorException({ code: "INTERNAL_ERROR", message: "Dung lượng báo cáo chưa hợp lệ" });
    const ttl = this.config.get<number>("REPORT_EXPORT_DOWNLOAD_TTL_SECONDS") ?? 120;
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const token = this.jwt.sign({ purpose: "REPORT_DOWNLOAD", sub: actorId, reportId: record.id, exp: expires }, { algorithm: "HS256", audience: "seminar-report-download" });
    return { id: record.id, periodId: record.periodId, evaluationId: record.evaluationId, reportType: record.reportType, format: record.format, fileName: record.fileName, sizeBytes: record.sizeBytes === null ? null : Number(record.sizeBytes), createdById: record.createdById, createdAt: record.createdAt, status: "READY" as const, downloadUrl: `/api/v1/admin/reports/exports/${record.id}/download?token=${encodeURIComponent(token)}`, downloadExpiresAt: new Date(expires * 1000).toISOString() };
  }

  /** Chọn MIME theo định dạng đã lưu, không suy ra từ đường dẫn hoặc dữ liệu client */
  private contentType(format: ReportFormat): string {
    return { XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", PDF: "application/pdf", DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }[format];
  }
}
