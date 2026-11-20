import { Controller, Get, Header, Inject, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { AuditLogsService } from "./audit-logs.service.js";
import { AUDIT_ACTIONS, AUDIT_ENTITIES, QueryAuditLogDto } from "./dto/query-audit-log.dto.js";
import { auditPageSchema, auditSchema } from "../evaluations/feedback-openapi.js";

/** Chỉ ADMIN đọc nhật ký, controller không nhận thao tác thêm/sửa/xóa lịch sử */
@ApiTags("Audit Logs")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 400, description: "Bộ lọc hoặc UUID không hợp lệ" })
@ApiResponse({ status: 401, description: "Cần đăng nhập bằng phiên hợp lệ" })
@ApiResponse({ status: 403, description: "Chỉ quản trị viên được đọc nhật ký" })
@ApiResponse({ status: 404, description: "Không tìm thấy nhật ký hoạt động" })
@Controller("api/v1/admin/audit-logs")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AuditLogsController {
  /** Tiêm rõ dependency theo Auth để bản build và runtime ESM có cùng hành vi */
  constructor(@Inject(AuditLogsService) private readonly service: AuditLogsService) {}

  /** Đọc trang theo DTO đã kiểm, cấm cache snapshot nhạy cảm tại trình duyệt */
  @Get()
  @ApiOkResponse({ schema: auditPageSchema })
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "[ADMIN] Tìm và lọc nhật ký hoạt động theo người thực hiện, hành động, đối tượng hoặc thời gian" })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "pageSize", required: false, type: Number, example: 20 })
  @ApiQuery({ name: "actorId", required: false, type: String, example: "SYSTEM hoặc UUID" })
  @ApiQuery({ name: "entity", required: false, enum: AUDIT_ENTITIES, description: "Loại bản ghi được ghi audit" })
  @ApiQuery({ name: "entityId", required: false, type: String })
  @ApiQuery({ name: "action", required: false, enum: AUDIT_ACTIONS, description: "Mã hành động được ghi audit" })
  @ApiQuery({ name: "from", required: false, type: String, format: "date-time" })
  @ApiQuery({ name: "to", required: false, type: String, format: "date-time" })
  findAll(@Query() query: QueryAuditLogDto) { return this.service.findAll(query); }

  /** Đọc chi tiết đã che bí mật bằng UUID, không trả quan hệ User nguyên bản */
  @Get(":id")
  @ApiOkResponse({ schema: auditSchema })
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "[ADMIN] Xem chi tiết giá trị trước và sau của một thao tác" })
  findOne(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return this.service.findOne(id); }
}
