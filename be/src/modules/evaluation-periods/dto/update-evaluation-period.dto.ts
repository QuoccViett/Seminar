import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";

/** Chỉ nhận cấu hình Admin có thể sửa trước khi kỳ mở
 * Giai đoạn và dấu thời gian công bố/chốt do các thao tác nghiệp vụ phía máy chủ quản lý
 * changeReason được yêu cầu khi sửa lịch đã công bố để lưu vết nguyên nhân thay đổi
 */
export class UpdateEvaluationPeriodDto {
  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @IsInt({ message: "Năm đánh giá phải là số nguyên" })
  @Min(2000, { message: "Năm đánh giá không hợp lệ" })
  year?: number;

  @ApiPropertyOptional({ example: "Đánh giá năm 2026" })
  @IsOptional()
  @IsString({ message: "Tên đợt đánh giá phải là chuỗi" })
  @IsNotEmpty({ message: "Tên đợt đánh giá không được để trống" })
  @MaxLength(255, { message: "Tên đợt đánh giá không được vượt quá 255 ký tự" })
  name?: string;

  @ApiPropertyOptional({ example: 300 })
  @IsOptional()
  @IsNumber({}, { message: "Tổng điểm tối đa phải là số" })
  @Min(0, { message: "Tổng điểm tối đa không được âm" })
  maxTotalScore?: number;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString({ strict: true }, { message: "Thời gian bắt đầu không hợp lệ" })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: "Thời gian phải kèm múi giờ Z hoặc độ lệch UTC" })
  selfEvalStart?: string | null;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString({ strict: true }, { message: "Thời hạn tự đánh giá không hợp lệ" })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: "Thời gian phải kèm múi giờ Z hoặc độ lệch UTC" })
  selfEvalDeadline?: string | null;

  @ApiPropertyOptional({ example: "Điều chỉnh theo thông báo của đơn vị" })
  @IsOptional()
  @IsString({ message: "Lý do thay đổi phải là chuỗi" })
  @IsNotEmpty({ message: "Lý do thay đổi không được để trống" })
  @MaxLength(500, { message: "Lý do thay đổi không được vượt quá 500 ký tự" })
  changeReason?: string;
}
