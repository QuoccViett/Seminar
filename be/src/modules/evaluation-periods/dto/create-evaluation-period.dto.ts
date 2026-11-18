import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";

/** Mô tả dữ liệu Admin được phép nhập khi tạo kỳ đánh giá
 * Backend khởi tạo phase và các dấu thời gian công bố/chốt để client không thể tự mở quyền
 * Các mốc tự chấm nhận chuỗi ngày giờ có múi giờ và được chuẩn hóa thành UTC ở service
 */
export class CreateEvaluationPeriodDto {
  @ApiProperty({ example: 2026 })
  @IsInt({ message: "Năm đánh giá phải là số nguyên" })
  @Min(2000, { message: "Năm đánh giá không hợp lệ" })
  year!: number;

  @ApiProperty({ example: "Đánh giá năm 2026" })
  @IsString({ message: "Tên đợt đánh giá phải là chuỗi" })
  @IsNotEmpty({ message: "Tên đợt đánh giá không được để trống" })
  @MaxLength(255, { message: "Tên đợt đánh giá không được vượt quá 255 ký tự" })
  name!: string;

  @ApiPropertyOptional({ example: 300, default: 300 })
  @IsOptional()
  @IsNumber({}, { message: "Tổng điểm tối đa phải là số" })
  @Min(0, { message: "Tổng điểm tối đa không được âm" })
  maxTotalScore?: number;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString({ strict: true }, { message: "Ngày nhập liệu không hợp lệ" })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: "Thời gian phải kèm múi giờ Z hoặc độ lệch UTC" })
  selfEvalStart?: string | null;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString({ strict: true }, { message: "Ngày nhập liệu không hợp lệ" })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: "Thời gian phải kèm múi giờ Z hoặc độ lệch UTC" })
  selfEvalDeadline?: string | null;

}
