import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { ERROR_CODES } from "../constants/error-codes.js";
import { ERROR_MESSAGES } from "../constants/error-messages.js";

type Detail = { field: string; messages: string[] };
type ApiError = { statusCode: number; code: string; message: string; details: Detail[] };
type RecordValue = Record<string, unknown>;

/** Chuyển ngoại lệ HTTP và cơ sở dữ liệu thành hợp đồng công khai bốn trường
 * Không phản chiếu lỗi SQL, provider, URL hay stack vì chúng có thể chứa bí mật
 * Các mã chưa nhận diện trả 500, còn lỗi trường đã chuẩn hóa được giữ nguyên
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /** Nhận ngoại lệ và ngữ cảnh HTTP, gửi đúng một phản hồi đã loại thông tin nhạy cảm
   * Ưu tiên mã Prisma, sau đó HTTP của Nest, cuối cùng dùng lỗi hệ thống chung
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{ status(code: number): { json(body: ApiError): void } }>();
    const error = this.toApiError(exception);
    if (error.statusCode >= 500) this.logger.error("Không thể hoàn tất yêu cầu do lỗi hệ thống");
    response.status(error.statusCode).json(error);
  }

  /** Chuẩn hóa một lỗi cho cả HTTP và kết quả từng ô batch đã rollback riêng
   * Chỉ trả bốn trường công khai, tái dùng ánh xạ DB để batch không lộ lỗi Prisma/SQL
   * Không ghi log tại đây vì caller có thể xử lý nhiều ô lỗi dự kiến trong một yêu cầu
   */
  toApiError(exception: unknown): ApiError {
    return this.databaseError(exception) ?? this.httpError(exception);
  }

  /** Ánh xạ mã Prisma và SQLSTATE đã biết sang trạng thái công khai an toàn
   * Unique và khóa ngoại là xung đột, CHECK và trigger là vi phạm quy tắc
   * SQLSTATE lạ không được đoán thành lỗi nghiệp vụ để tránh che lỗi hệ thống
   */
  private databaseError(exception: unknown): ApiError | undefined {
    const error = this.record(exception);
    const code = error?.code;
    const meta = this.record(error?.meta);
    // Trigger VC12 dùng SQLSTATE riêng tại câu ghi để deadline không bị trả thành lỗi SQL chung
    // Chỉ đọc mã cấu trúc đã biết, không phản chiếu message, detail hoặc payload từ adapter
    const adapterCause = this.record(this.record(meta?.driverAdapterError)?.cause);
    const databaseState = typeof meta?.code === "string" ? meta.code : typeof adapterCause?.originalCode === "string" ? adapterCause.originalCode : "";
    if (databaseState === "P4012") return { statusCode: 403, code: "DEADLINE_PASSED", message: "Đã hết thời gian bổ sung hồ sơ", details: [] };
    if (code === "P2002") {
      const target = Array.isArray(meta?.target) ? meta.target.join(" ") : String(meta?.target ?? "");
      const key = target.toLowerCase().replace(/[_\s]/g, "");
      const publicCode = key.includes("username") ? ERROR_CODES.USERNAME_TAKEN
        : key.includes("unitcode") || (key === "code" && meta?.modelName === "Unit")
          ? ERROR_CODES.UNIT_CODE_TAKEN : ERROR_CODES.CONFLICT;
      return this.make(409, publicCode);
    }
    if (code === "P2003") return this.make(409, ERROR_CODES.REFERENCE_IN_USE);
    if (code === "P2025") return this.make(404, ERROR_CODES.NOT_FOUND);
    if (code === "P2004") {
      // Thao tác model của Prisma bọc lỗi CHECK/trigger thành P2004 và không luôn giữ SQLSTATE trong meta
      // Ánh xạ sang lỗi quy tắc chung để giữ status có nghĩa mà không đưa tên constraint hay SQL ra API
      return this.make(422, ERROR_CODES.DB_RULE_VIOLATION);
    }
    if (code === "P2010" || code === "P2039") {
      // Adapter PostgreSQL đặt SQLSTATE trong cause, Prisma cũ có thể đặt trực tiếp trong meta
      const cause = this.record(this.record(meta?.driverAdapterError)?.cause);
      const state = typeof meta?.code === "string" ? meta.code : typeof cause?.originalCode === "string" ? cause.originalCode : "";
      if (state === "23505") return this.make(409, ERROR_CODES.CONFLICT);
      if (state === "23503") return this.make(409, ERROR_CODES.REFERENCE_IN_USE);
      if (state === "23514" || state === "P0001" || state === "23502") return this.make(422, ERROR_CODES.DB_RULE_VIOLATION);
      return this.make(500, ERROR_CODES.INTERNAL_ERROR);
    }
    return undefined;
  }

  /** Chuẩn hóa ngoại lệ HTTP, giữ status và mã dự án nhưng không tin thông điệp framework
   * Chỉ payload có code do ứng dụng đặt mới được giữ câu tiếng Việt và details hợp lệ
   * Lỗi parser, pipe và route mặc định dùng câu cố định không chứa dữ liệu request
   */
  private httpError(exception: unknown): ApiError {
    // Parser Express và Multer có mã riêng, chỉ nhận dạng các mã đã biết thay vì tin status tùy ý
    const parser = this.record(exception);
    if (parser?.type === "entity.too.large" || parser?.code === "LIMIT_FILE_SIZE") return this.make(413, ERROR_CODES.FILE_TOO_LARGE);
    if (parser?.type === "entity.parse.failed" || parser?.code === "LIMIT_UNEXPECTED_FILE") return this.make(400, ERROR_CODES.VALIDATION_ERROR);
    if (!(exception instanceof HttpException)) return this.make(500, ERROR_CODES.INTERNAL_ERROR);
    const status = exception.getStatus();
    const payload = this.record(exception.getResponse());
    const defaults: Record<number, string> = {
      400: ERROR_CODES.VALIDATION_ERROR, 401: ERROR_CODES.UNAUTHORIZED,
      403: ERROR_CODES.FORBIDDEN, 404: ERROR_CODES.NOT_FOUND, 405: ERROR_CODES.METHOD_NOT_ALLOWED, 409: ERROR_CODES.CONFLICT,
      413: ERROR_CODES.FILE_TOO_LARGE, 415: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      422: ERROR_CODES.BUSINESS_RULE_VIOLATION, 429: ERROR_CODES.TOO_MANY_REQUESTS,
      503: ERROR_CODES.DATABASE_UNAVAILABLE,
    };
    const custom = typeof payload?.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(payload.code) ? payload.code : undefined;
    const code = custom ?? defaults[status] ?? ERROR_CODES.INTERNAL_ERROR;
    const result = this.make(status, code);
    if (custom && status < 500 && typeof payload?.message === "string" && /[À-ỹ]/u.test(payload.message)) {
      result.message = payload.message;
      if (Array.isArray(payload.details)) {
        result.details = payload.details.flatMap((item: unknown) => {
          const detail = this.record(item);
          return typeof detail?.field === "string" && Array.isArray(detail.messages)
            && detail.messages.every((message: unknown) => typeof message === "string" && /[À-ỹ]/u.test(message))
            ? [{ field: detail.field, messages: detail.messages as string[] }] : [];
        });
      }
    }
    return result;
  }

  /** Tạo đủ bốn trường cho mọi nhánh và dùng câu chung khi mã chưa có trong danh mục
   * Mã kỹ thuật không bị thay đổi để client tiếp tục xử lý các trường hợp nghiệp vụ
   */
  private make(statusCode: number, code: string): ApiError {
    return { statusCode, code, message: ERROR_MESSAGES[code] ?? "Không thể thực hiện yêu cầu.", details: [] };
  }

  /** Chỉ ép kiểu object khác null, tránh đọc thuộc tính từ dữ liệu ngoại lệ bất kỳ */
  private record(value: unknown): RecordValue | undefined {
    return typeof value === "object" && value !== null ? value as RecordValue : undefined;
  }
}
