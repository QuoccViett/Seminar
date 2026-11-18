import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsUUID,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from "class-validator";

export const REPORT_TYPES = [
  "SUMMARY_ALL_UNITS",
  "UNIT_APPRAISAL_MINUTES",
] as const;

export const REPORT_FORMATS = ["XLSX", "PDF", "DOCX"] as const;

export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportFormat = (typeof REPORT_FORMATS)[number];

@ValidatorConstraint({ name: "reportEvaluationScope", async: false })
/** Kiểm chéo loại báo cáo và mã hồ sơ, không bỏ qua trường thiếu bằng IsOptional
 * Tổng hợp cấm cả null, còn biên bản cần UUID để service xác minh đúng kỳ
 */
class ReportEvaluationScopeConstraint
  implements ValidatorConstraintInterface
{
  /** Đọc toàn bộ body vì validator được gắn ở reportType luôn bắt buộc */
  validate(_value: unknown, args: ValidationArguments): boolean {
    const body = args.object as CreateReportExportDto;
    const evaluationId = body.evaluationId;

    if (body.reportType === "SUMMARY_ALL_UNITS") {
      return evaluationId === undefined;
    }

    if (body.reportType === "UNIT_APPRAISAL_MINUTES") {
      return typeof evaluationId === "string" && evaluationId.length > 0;
    }

    return true;
  }

  /** Trả hướng dẫn theo loại đang chọn, không phản chiếu payload thô của client */
  defaultMessage(args: ValidationArguments): string {
    const body = args.object as CreateReportExportDto;

    return body.reportType === "SUMMARY_ALL_UNITS"
      ? "evaluationId không được cung cấp cho báo cáo SUMMARY_ALL_UNITS"
      : "evaluationId là bắt buộc cho báo cáo UNIT_APPRAISAL_MINUTES";
  }
}

/** Payload tạo đồng bộ chỉ nhận scope và định dạng, không nhận người tạo hoặc đường dẫn
 * Ràng buộc UUID ở biên API bổ sung cho các kiểm nghiệp vụ và scope trong service
 */
export class CreateReportExportDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    description: "ID đợt đánh giá",
  })
  @IsUUID("4", { message: "periodId phải là UUID hợp lệ" })
  periodId!: string;

  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    description:
      "Bắt buộc với UNIT_APPRAISAL_MINUTES; không được gửi với SUMMARY_ALL_UNITS",
  })
  @ValidateIf((body: CreateReportExportDto, value) => value !== undefined || body.reportType === "UNIT_APPRAISAL_MINUTES")
  @IsUUID("4", { message: "evaluationId phải là UUID hợp lệ" })
  evaluationId?: string;

  @ApiProperty({
    enum: REPORT_TYPES,
    enumName: "ReportType",
  })
  @IsIn(REPORT_TYPES, { message: "reportType không được hỗ trợ" })
  @Validate(ReportEvaluationScopeConstraint)
  reportType!: ReportType;

  @ApiProperty({
    enum: REPORT_FORMATS,
    enumName: "ReportFormat",
  })
  @IsIn(REPORT_FORMATS, { message: "format không được hỗ trợ" })
  format!: ReportFormat;
}
