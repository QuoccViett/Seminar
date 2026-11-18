import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto.js";

/** Giới hạn truy vấn danh sách bằng kỳ và trạng thái ngoài phân trang chung
 * Không nhận unitId để UNIT không thể đổi phạm vi lấy từ phiên đăng nhập
 * Bộ lọc không cấp thêm quyền, service luôn ghép điều kiện sở hữu và công bố
 */
export class EvaluationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "Mã kỳ đánh giá không hợp lệ" })
  periodId?: string;

  @ApiPropertyOptional({ enum: ["DRAFT", "PENDING_REVIEW", "SUPPLEMENT_REQUESTED", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED", "FINALIZED"] })
  @IsOptional()
  @IsIn(["DRAFT", "PENDING_REVIEW", "SUPPLEMENT_REQUESTED", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED", "FINALIZED"], { message: "Trạng thái hồ sơ không hợp lệ" })
  status?: string;
}

/** Nhận kỳ cần tạo bù hồ sơ sau công bố, chỉ ADMIN được chỉ định đơn vị
 * unitId tùy chọn ở DTO vì UNIT lấy đơn vị từ phiên, service kiểm chặt theo vai trò
 * Không nhận điểm, trạng thái hoặc người tạo do các giá trị này thuộc máy chủ
 */
export class CreateEvaluationDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "Mã kỳ đánh giá không hợp lệ" })
  periodId!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID("4", { message: "Mã đơn vị không hợp lệ" })
  unitId?: string;
}

/** Chỉ nhận hai trường tự chấm, phân biệt bỏ qua với null chủ động xóa
 * Điểm phải hữu hạn, không âm và tối đa hai chữ số thập phân, maxScore kiểm từ DB
 * Diễn giải là văn bản thuần, không xử lý HTML và không tự ép chuỗi thành số
 * Body rỗng bị service từ chối để tránh tạo audit hoặc báo lưu giả
 */
export class SelfScoreDto {
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, multipleOf: 0.01, example: 8.25 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: "Điểm tự chấm phải là số có tối đa hai chữ số thập phân" })
  @Min(0, { message: "Điểm tự chấm không được âm" })
  selfScore?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString({ message: "Diễn giải phải là văn bản" })
  @MaxLength(5000, { message: "Diễn giải không được vượt quá 5000 ký tự" })
  selfNote?: string | null;
}

/** Gắn mỗi ô trong batch với UUID tiêu chí, kế thừa đúng validation lưu đơn
 * Không nhận scoreId để client không thể trỏ sang một hồ sơ khác
 */
export class BatchSelfScoreItemDto extends SelfScoreDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "Mã tiêu chí không hợp lệ" })
  criterionId!: string;
}

/** Kiểm cấu trúc toàn batch trước khi service chạy transaction riêng từng ô
 * Mảng 1..100 ô không lặp tiêu chí tránh hai lần ghi cùng ô với kết quả khó hiểu
 * Type và ValidateNested bảo đảm trường lạ hoặc điểm sai kiểu không lọt qua mảng
 */
export class BatchSelfScoreDto {
  @ApiProperty({ type: [BatchSelfScoreItemDto], minItems: 1, maxItems: 100 })
  @IsArray({ message: "Danh sách điểm phải là mảng" })
  @ArrayMinSize(1, { message: "Cần ít nhất một tiêu chí để lưu" })
  @ArrayMaxSize(100, { message: "Mỗi lần chỉ được lưu tối đa 100 tiêu chí" })
  @ArrayUnique((item: BatchSelfScoreItemDto) => item?.criterionId, { message: "Không được lặp tiêu chí trong cùng lần lưu" })
  @ValidateNested({ each: true })
  @Type(() => BatchSelfScoreItemDto)
  items!: BatchSelfScoreItemDto[];
}

/** Lệnh nộp chỉ nhận đối tượng rỗng, whitelist từ chối mọi trường hệ thống
 * Máy chủ tự cấp submittedAt và trạng thái, không nhận giờ hoặc tổng do client tính
 */
export class SubmitEvaluationDto {}
