import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

/** Nhận bộ lọc hộp thư của chính người đăng nhập, phân trang giới hạn để tránh truy vấn quá lớn
 * Đầu vào là query dạng chuỗi; đầu ra được chuyển sang số và trạng thái đọc hợp lệ trước khi service truy vấn
 */
export class NotificationQueryDto {
  /** Trang bắt đầu từ một; giá trị không phải số nguyên sẽ bị từ chối thay vì tự làm tròn */
  @ApiPropertyOptional({ type: Number, default: 1 })
  @Transform(({ value }) => value === undefined ? 1 : Number(value))
  @IsInt({ message: "page phải là số nguyên." })
  @Min(1, { message: "page phải lớn hơn hoặc bằng 1." })
  page = 1;

  /** Số thông báo tối đa mỗi trang; chặn truy vấn không giới hạn ngay tại biên HTTP */
  @ApiPropertyOptional({ type: Number, default: 20, maximum: 100 })
  @Transform(({ value }) => value === undefined ? 20 : Number(value))
  @IsInt({ message: "pageSize phải là số nguyên." })
  @Min(1, { message: "pageSize phải lớn hơn hoặc bằng 1." })
  @Max(100, { message: "pageSize không được vượt quá 100." })
  pageSize = 20;

  /** Chỉ chấp nhận hai chuỗi rõ nghĩa để không biến giá trị sai thành bộ lọc khác */
  @ApiPropertyOptional({ enum: ["true", "false"] })
  @IsOptional()
  @IsIn(["true", "false"], { message: "isRead chỉ được là true hoặc false." })
  isRead?: "true" | "false";
}
