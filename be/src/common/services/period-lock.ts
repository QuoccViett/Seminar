import type { Prisma } from "../../generated/prisma/client.js";

/** Khóa hàng kỳ trong transaction để tuần tự hóa công bố và chỉnh cấu hình
 * transaction là kết nối đang ghi, periodId là UUID kỳ cần thao tác
 * Khóa được giữ đến khi commit hoặc rollback và không tạo dữ liệu nếu kỳ không tồn tại
 * Mọi đường ghi cấu hình phải lấy cùng khóa trước khi đọc trạng thái công bố
 */
export async function lockPeriod(transaction: Prisma.TransactionClient, periodId: string, mode: "exclusive" | "shared" = "exclusive"): Promise<void> {
  if (mode === "shared") {
    // Các hồ sơ khác nhau được ghi đồng thời; cấu hình/chuyển phase vẫn chờ mọi hồ sơ commit.
    await transaction.$queryRaw`SELECT id FROM evaluation_periods WHERE id = ${periodId}::uuid FOR SHARE`;
  } else {
    await transaction.$queryRaw`SELECT id FROM evaluation_periods WHERE id = ${periodId}::uuid FOR UPDATE`;
  }
}
