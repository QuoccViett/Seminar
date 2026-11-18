import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from "class-validator";
import { PreviewSupplementScheduleDto } from "../../evaluation-periods/dto/preview-supplement-schedule.dto.js";

/** Nhận điểm và lý do cho một lá, không nhận danh tính hoặc trạng thái từ client
 * Service kiểm giới hạn tối đa và lý do sau khi khóa snapshot hồ sơ
 */
export class ReviewScoreDto {
  @ApiProperty({ minimum: 0, multipleOf: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: "Điểm thẩm định phải là số có tối đa hai chữ số thập phân" })
  @Min(0, { message: "Điểm thẩm định không được âm" })
  adminScore!: number;

  @ApiPropertyOptional({ nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString({ message: "Lý do thẩm định phải là văn bản" })
  @MaxLength(5000, { message: "Lý do thẩm định không được vượt quá 5000 ký tự" })
  adminComment?: string | null;
}

/** Ghi chú riêng cho một tiêu chí lá được yêu cầu bổ sung
 * UUID xác định lá trong hồ sơ, service tiếp tục kiểm nội dung không trắng và quyền
 */
export class SupplementItemDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "Mã tiêu chí không hợp lệ" })
  criterionId!: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString({ message: "Yêu cầu bổ sung phải là văn bản" })
  @MaxLength(5000, { message: "Yêu cầu bổ sung không được vượt quá 5000 ký tự" })
  note!: string;
}

/** Nhận lịch có múi giờ cùng danh sách lá, không cho lặp hoặc gửi danh sách rỗng
 * Deadline do service tính bằng quy tắc ngày Việt Nam thay vì nhận từ client
 */
export class SupplementRequestDto extends PreviewSupplementScheduleDto {
  @ApiProperty({ type: [SupplementItemDto], minItems: 1, maxItems: 100 })
  @IsArray({ message: "Danh sách tiêu chí phải là mảng" })
  @ArrayMinSize(1, { message: "Cần chọn ít nhất một tiêu chí bổ sung" })
  @ArrayMaxSize(100, { message: "Mỗi yêu cầu chỉ được chọn tối đa 100 tiêu chí" })
  @ArrayUnique((item: SupplementItemDto) => item?.criterionId, { message: "Không được lặp tiêu chí trong yêu cầu bổ sung" })
  @ValidateNested({ each: true, message: "Thông tin từng tiêu chí bổ sung không hợp lệ" })
  @Type(() => SupplementItemDto)
  items!: SupplementItemDto[];
}

/** Một mục thẩm định hàng loạt dùng cùng quy tắc điểm và lý do như lệnh đơn
 * criterionId xác định tiêu chí trong hồ sơ đã chọn, không nhận scoreId tùy ý
 */
export class BatchReviewItemDto extends ReviewScoreDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "Mã tiêu chí không hợp lệ" })
  criterionId!: string;
}

/** Kiểm cấu trúc và tiêu chí không trùng trước khi xử lý độc lập từng mục */
export class BatchReviewDto {
  @ApiProperty({ type: [BatchReviewItemDto], minItems: 1, maxItems: 100 })
  @IsArray({ message: "Danh sách điểm phải là mảng" })
  @ArrayMinSize(1, { message: "Cần ít nhất một tiêu chí để thẩm định" })
  @ArrayMaxSize(100, { message: "Mỗi lần chỉ được thẩm định tối đa 100 tiêu chí" })
  @ArrayUnique((item: BatchReviewItemDto) => item?.criterionId, { message: "Không được lặp tiêu chí trong cùng lần lưu" })
  @ValidateNested({ each: true, message: "Thông tin từng điểm thẩm định không hợp lệ" })
  @Type(() => BatchReviewItemDto)
  items!: BatchReviewItemDto[];
}

/** Giới hạn danh sách chốt hàng loạt và loại trừ UUID trùng trước khi ghi */
export class BatchFinalizeDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray({ message: "Danh sách hồ sơ phải là mảng" })
  @ArrayMinSize(1, { message: "Cần chọn ít nhất một hồ sơ" })
  @ArrayMaxSize(100, { message: "Mỗi lần chỉ được chọn tối đa 100 hồ sơ" })
  @ArrayUnique({ message: "Không được lặp hồ sơ trong cùng lần chốt" })
  @IsUUID("4", { each: true, message: "Mã hồ sơ không hợp lệ" })
  evaluationIds!: string[];
}
