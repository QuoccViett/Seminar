import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { TimelineQueryDto } from "../../evaluations/dto/feedback.dto.js";

/** Các entity được dùng trong lời gọi AuditService.record ở backend hiện tại. */
export const AUDIT_ENTITIES = [
  "CredentialDelivery",
  "CredentialDispatch",
  "Criterion",
  "CriterionScore",
  "Evaluation",
  "EvaluationFeedback",
  "EvaluationPeriod",
  "Evidence",
  "ImportSession",
  "Notification",
  "NotificationDelivery",
  "ReportExport",
  "Unit",
  "User",
] as const;

/** Các action tĩnh và mọi nhánh action động hiện có trong lời gọi AuditService.record. */
export const AUDIT_ACTIONS = [
  "AUTO_STATUS",
  "CREDENTIAL_DELIVERY_RETRIED",
  "CREDENTIAL_EMAIL_CONFIRMED",
  "CREATE",
  "DELETE",
  "FEEDBACK_CREATED",
  "FINALIZE",
  "FIRST_REVIEW_COMPLETE",
  "LOGIN_FAILED",
  "LOGIN_SUCCESS",
  "NOTIFICATION_DELIVERY",
  "NOTIFICATION_QUEUED",
  "PASSWORD_CHANGED",
  "PUBLISH",
  "REPORT_DOWNLOADED",
  "REPORT_EXPORTED",
  "REVIEW_INVALIDATED",
  "REVIEW_SCORE",
  "SELF_SCORE",
  "SUBMIT",
  "SUPPLEMENT_REQUEST",
  "SUPPLEMENT_SUBMIT",
  "TRANSITION_PHASE",
  "UNIT_CREATED",
  "UNIT_UPDATED",
  "UPDATE",
  "UPSERT_THRESHOLDS",
  "UNITS_IMPORTED",
  "USER_ACTIVATED",
  "USER_CREATED",
  "USER_DEACTIVATED",
  "USER_IMPORTED",
  "USER_PASSWORD_RESET",
  "USER_UPDATED",
] as const;

/** Kiểm bộ lọc audit trước DB, SYSTEM là định danh ổn định cho actor null
 * Dùng cùng pagination với timeline, ngày có Z hoặc offset để tránh lệch múi giờ
 */
export class QueryAuditLogDto extends TimelineQueryDto {
  @ApiPropertyOptional({ example: "SYSTEM" })
  @IsOptional()
  @Matches(/^(?:SYSTEM|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i, { message: "Người thực hiện phải là UUID hợp lệ hoặc SYSTEM" })
  actorId?: string;

  @ApiPropertyOptional({ example: "CriterionScore" })
  @IsOptional()
  @IsString({ message: "Loại đối tượng phải là chuỗi" })
  @MaxLength(100, { message: "Loại đối tượng tối đa 100 ký tự" })
  entity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: "Mã đối tượng phải là chuỗi" })
  @MaxLength(255, { message: "Mã đối tượng tối đa 255 ký tự" })
  entityId?: string;

  @ApiPropertyOptional({ example: "REVIEW_SCORE" })
  @IsOptional()
  @IsString({ message: "Hành động phải là chuỗi" })
  @MaxLength(100, { message: "Hành động tối đa 100 ký tự" })
  action?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString({ strict: true }, { message: "Thời gian bắt đầu không hợp lệ" })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: "Thời gian bắt đầu phải có múi giờ" })
  from?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString({ strict: true }, { message: "Thời gian kết thúc không hợp lệ" })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: "Thời gian kết thúc phải có múi giờ" })
  to?: string;
}
