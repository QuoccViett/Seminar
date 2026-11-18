import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Kiểm metadata xin tải trước khi dành quota, chỉ nhận lá và không nhận key/round từ client
 * sizeBytes là số nguyên byte tối đa 10 MiB, loại tệp được service kiểm chéo với extension
 */
export class UploadItemDto {
  @ApiProperty({ description: "Mã tiêu chí lá", format: "uuid" })
  @IsUUID("4", { message: "Mã tiêu chí phải là UUID hợp lệ" })
  criterionId!: string;

  @ApiProperty({ description: "Tên tệp gốc", example: "Báo cáo.pdf" })
  @IsString({ message: "Tên tệp phải là chuỗi" })
  @IsNotEmpty({ message: "Tên tệp không được để trống" })
  @MaxLength(180, { message: "Tên tệp không được vượt quá 180 ký tự" })
  fileName!: string;

  @ApiProperty({ description: "MIME của tệp", example: "application/pdf" })
  @IsString({ message: "Loại tệp phải là chuỗi" })
  @MaxLength(120, { message: "Loại tệp không được vượt quá 120 ký tự" })
  mimeType!: string;

  @ApiProperty({ description: "Kích thước byte", minimum: 1, maximum: 10485760 })
  @IsInt({ message: "Kích thước tệp phải là số nguyên" })
  @Min(1, { message: "Tệp phải có nội dung" })
  @Max(10485760, { message: "Mỗi tệp không được vượt quá 10 MiB" })
  sizeBytes!: number;
}

/** Kiểm mảng nested trước mọi ghi để batch không bị mass assignment hoặc nhận phần tử null */
export class UploadBatchDto {
  @ApiProperty({ type: [UploadItemDto], description: "Tối đa mười tệp mỗi lượt" })
  @IsArray({ message: "Danh sách tệp phải là mảng" })
  @ArrayMinSize(1, { message: "Cần chọn ít nhất một tệp" })
  @ArrayMaxSize(10, { message: "Mỗi lượt chỉ được chọn tối đa 10 tệp" })
  @ValidateNested({ each: true, message: "Thông tin từng tệp không hợp lệ" })
  @Type(() => UploadItemDto)
  items!: UploadItemDto[];
}

/** DTO xác nhận tách FILE và LINK, service kiểm thêm tổ hợp trường không được áp dụng
 * FILE chỉ tham chiếu phiên server đã cấp, LINK không bao giờ được backend tự tải nội dung
 */
export class EvidenceItemDto {
  @ApiProperty({ description: "Loại minh chứng", enum: ["FILE", "LINK"] })
  @IsIn(["FILE", "LINK"], { message: "Loại minh chứng phải là FILE hoặc LINK" })
  kind!: "FILE" | "LINK";

  @ApiProperty({ description: "Mã tiêu chí lá", format: "uuid" })
  @IsUUID("4", { message: "Mã tiêu chí phải là UUID hợp lệ" })
  criterionId!: string;

  @ApiPropertyOptional({ description: "Mã phiên tải cho FILE", format: "uuid" })
  @ValidateIf((item: EvidenceItemDto) => item.kind === "FILE" || item.uploadId !== undefined)
  @IsUUID("4", { message: "Mã phiên tải phải là UUID hợp lệ" })
  uploadId?: string;

  @ApiPropertyOptional({ description: "Liên kết HTTP hoặc HTTPS", maxLength: 2048 })
  @ValidateIf((item: EvidenceItemDto) => item.kind === "LINK" || item.externalUrl !== undefined)
  @IsString({ message: "Liên kết phải là chuỗi" })
  @MaxLength(2048, { message: "Liên kết không được vượt quá 2048 ký tự" })
  externalUrl?: string;

  @ApiPropertyOptional({ description: "Mô tả văn bản thuần", maxLength: 2000 })
  @ValidateIf((item: EvidenceItemDto) => item.description !== undefined)
  @IsString({ message: "Mô tả minh chứng phải là chuỗi" })
  @MaxLength(2000, { message: "Mô tả minh chứng không được vượt quá 2000 ký tự" })
  description?: string;
}

/** Xác nhận mỗi item bằng transaction riêng, lỗi nghiệp vụ không hủy tệp khác đã xác nhận */
export class EvidenceBatchDto {
  @ApiProperty({ type: [EvidenceItemDto], description: "Danh sách tệp và liên kết cần xác nhận" })
  @IsArray({ message: "Danh sách minh chứng phải là mảng" })
  @ArrayMinSize(1, { message: "Cần gửi ít nhất một minh chứng" })
  @ArrayMaxSize(10, { message: "Mỗi lượt chỉ được gửi tối đa 10 minh chứng" })
  @ValidateNested({ each: true, message: "Thông tin từng minh chứng không hợp lệ" })
  @Type(() => EvidenceItemDto)
  items!: EvidenceItemDto[];
}
