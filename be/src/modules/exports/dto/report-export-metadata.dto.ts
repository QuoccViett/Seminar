import { ApiProperty } from "@nestjs/swagger";
import { REPORT_FORMATS, REPORT_TYPES } from "./create-report-export.dto.js";

/** Mô tả phản hồi tạo/xem của báo cáo đồng bộ, không khai báo storagePath hoặc thông tin ký bí mật
 * READY nghĩa là bytes và metadata đã lưu, URL có hạn được cấp riêng cho người đang đọc
 */
export class ReportExportMetadataDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) periodId!: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) evaluationId!: string | null;
  @ApiProperty({ enum: REPORT_TYPES }) reportType!: string;
  @ApiProperty({ enum: REPORT_FORMATS }) format!: string;
  @ApiProperty({ type: String, nullable: true }) fileName!: string | null;
  @ApiProperty({ type: Number, nullable: true, maximum: Number.MAX_SAFE_INTEGER }) sizeBytes!: number | null;
  @ApiProperty({ format: "uuid" }) createdById!: string;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: string;
  @ApiProperty({ enum: ["READY"] }) status!: string;
  @ApiProperty({ description: "Đường dẫn API tương đối có chữ ký ngắn hạn, vẫn yêu cầu JWT ADMIN" }) downloadUrl!: string;
  @ApiProperty({ type: String, format: "date-time" }) downloadExpiresAt!: string;
}

/** Trang lịch sử dùng cùng metadata với endpoint chi tiết, total độc lập số phần tử trong trang */
export class ReportExportPageDto {
  @ApiProperty({ type: [ReportExportMetadataDto] }) items!: ReportExportMetadataDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
