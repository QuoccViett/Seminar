import { Body, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GetCurrentUser, type CurrentUser } from "../../common/decorators/current-user.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { CreateFeedbackDto, TimelineQueryDto } from "./dto/feedback.dto.js";
import { FeedbackService } from "./feedback.service.js";
import { feedbackPageSchema, feedbackSchema, historyPageSchema } from "./feedback-openapi.js";

/** Nhận DTO và identity đã xác thực theo mẫu Auth, không chứa nghiệp vụ hoặc transaction */
@ApiTags("Feedback and History")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 400, description: "Dữ liệu phản hồi hoặc phân trang không hợp lệ" })
@ApiResponse({ status: 401, description: "Cần đăng nhập bằng phiên hợp lệ" })
@ApiResponse({ status: 403, description: "Không được gửi loại phản hồi hoặc hồ sơ đã khóa" })
@ApiResponse({ status: 404, description: "Không tìm thấy hồ sơ trong phạm vi" })
@ApiResponse({ status: 429, description: "Gửi phản hồi vượt giới hạn cho phép", schema: { $ref: "#/components/schemas/ApiError" } })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "UNIT")
@Controller("api/v1/evaluations/:evaluationId")
export class FeedbackController {
  /** Tiêm rõ dependency để ESM không phụ thuộc metadata suy luận của transpiler */
  constructor(@Inject(FeedbackService) private readonly service: FeedbackService) {}

  /** Đọc trang trao đổi theo quyền do service kiểm và cấm lưu cache dữ liệu hồ sơ */
  @Get("feedback")
  @ApiOkResponse({ schema: feedbackPageSchema })
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "[ADMIN, UNIT] Xem trao đổi của hồ sơ và các loại phản hồi được phép gửi" })
  @ApiParam({ name: "evaluationId", type: String, format: "uuid" })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "pageSize", required: false, type: Number, example: 20 })
  list(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Query() query: TimelineQueryDto, @GetCurrentUser() user: CurrentUser) { return this.service.list(id, query, user); }

  /** Thêm một phản hồi bất biến, không nhận authorId hoặc timestamp từ request */
  @Post("feedback")
  @ApiCreatedResponse({ schema: feedbackSchema })
  @Header("Cache-Control", "no-store")
  @ApiBody({ type: CreateFeedbackDto })
  @ApiOperation({ summary: "[ADMIN, UNIT] Gửi phản hồi văn bản thuần theo vai trò và trạng thái hồ sơ" })
  create(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() dto: CreateFeedbackDto, @GetCurrentUser() user: CurrentUser) { return this.service.create(id, dto, user); }

  /** Đọc lịch sử trạng thái với tên người thao tác hoặc Hệ thống, không cho sửa/xóa */
  @Get("status-history")
  @ApiOkResponse({ schema: historyPageSchema })
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "[ADMIN, UNIT] Xem lịch sử chuyển trạng thái của hồ sơ" })
  @ApiParam({ name: "evaluationId", type: String, format: "uuid" })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "pageSize", required: false, type: Number, example: 20 })
  history(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Query() query: TimelineQueryDto, @GetCurrentUser() user: CurrentUser) { return this.service.history(id, query, user); }
}
