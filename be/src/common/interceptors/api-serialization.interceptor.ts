import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { Prisma } from "../../generated/prisma/client.js";

/** Chuyển các kiểu Prisma không tương thích JSON thành giá trị công khai ổn định
 * Date dùng ISO UTC, Decimal làm tròn hai chữ số, BigInt lớn giữ chính xác bằng chuỗi
 * Mảng và đối tượng được sao chép đệ quy, không thay đổi kết quả gốc của service
 */
export function serializeApiValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  if (Array.isArray(value)) return value.map(serializeApiValue);
  if (value !== null && typeof value === "object") {
    // Giữ nguyên stream, buffer và đối tượng đặc biệt để không làm hỏng luồng tải tệp
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeApiValue(item)]));
  }
  return value;
}

@Injectable()
export class ApiSerializationInterceptor implements NestInterceptor {
  /** Áp dụng quy tắc chuyển kiểu lên dữ liệu trả về của controller trước khi xuất JSON
   * Ngoại lệ vẫn đi qua filter, còn response đã ghi thủ công không bị thay thế
   */
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(serializeApiValue));
  }
}
