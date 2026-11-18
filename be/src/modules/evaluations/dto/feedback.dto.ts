import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsString, Length, Matches, Max, Min } from "class-validator";

/** Kiểm trang trước truy vấn để giới hạn tải DB và không nhận tùy chọn sắp xếp tùy ý
 * Giá trị mặc định áp dụng khi thiếu query, đầu ra luôn là số nguyên trong giới hạn
 */
export class TimelineQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt({ message: "Trang phải là số nguyên" })
  @Min(1, { message: "Trang tối thiểu là 1" })
  @Max(1000000, { message: "Trang vượt quá giới hạn cho phép" })
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt({ message: "Số dòng phải là số nguyên" })
  @Min(1, { message: "Số dòng tối thiểu là 1" })
  @Max(100, { message: "Số dòng tối đa là 100" })
  pageSize = 20;
}

/** Chỉ nhận loại trao đổi và văn bản thuần, danh tính/lịch/trạng thái do server cấp
 * Trim trước kiểm độ dài để chặn nội dung trắng, giữ xuống dòng để diễn giải dễ đọc
 * Loại hợp lệ vẫn được service kiểm theo vai trò, không cho giả yêu cầu bổ sung VC12
 */
export class CreateFeedbackDto {
  @ApiProperty({ enum: ["GENERAL", "EXPLANATION_REQUEST", "UNIT_REPLY"] })
  @IsIn(["GENERAL", "EXPLANATION_REQUEST", "UNIT_REPLY"], { message: "Loại phản hồi không hợp lệ" })
  type!: string;

  @ApiProperty({ minLength: 1, maxLength: 4000, example: "Đề nghị đơn vị giải trình nội dung đánh giá" })
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString({ message: "Nội dung phản hồi phải là văn bản" })
  @Length(1, 4000, { message: "Nội dung phản hồi phải có từ 1 đến 4000 ký tự" })
  // eslint-disable-next-line no-control-regex -- Cố ý nhận diện mã điều khiển để từ chối đầu vào nguy hiểm, vẫn cho tab và xuống dòng
  @Matches(/^(?![\s\S]*<\/?[a-z!])[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/i, { message: "Phản hồi chỉ nhận văn bản thuần, không chứa thẻ HTML hoặc ký tự điều khiển" })
  content!: string;
}
