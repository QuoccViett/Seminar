import { Controller, Get, Header, Inject, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { AuditLogsService } from "./audit-logs.service.js";
import { QueryAuditLogDto } from "./dto/query-audit-log.dto.js";
import { auditPageSchema, auditSchema } from "../evaluations/feedback-openapi.js";

/** Chỉ ADMIN đọc nhật ký, controller không nhận thao tác thêm/sửa/xóa lịch sử */
@ApiTags("Nhật ký hoạt động")
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
  @ApiOperation({ summary: "Tìm và lọc nhật ký hoạt động" })
  findAll(@Query() query: QueryAuditLogDto) { return this.service.findAll(query); }

  /** Đọc chi tiết đã che bí mật bằng UUID, không trả quan hệ User nguyên bản */
  @Get(":id")
  @ApiOkResponse({ schema: auditSchema })
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Chi tiết thay đổi trước và sau thao tác" })
  findOne(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return this.service.findOne(id); }
}
