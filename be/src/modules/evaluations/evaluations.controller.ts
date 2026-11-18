import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GetCurrentUser, type CurrentUser } from "../../common/decorators/current-user.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { BatchSelfScoreDto, CreateEvaluationDto, EvaluationQueryDto, SelfScoreDto, SubmitEvaluationDto } from "./dto/evaluation.dto.js";
import { EvaluationsService } from "./evaluations.service.js";
import { batchSelfScoreSchema, evaluationDetailSchema, evaluationMetadataSchema, evaluationSummarySchema, savedSelfScoreSchema } from "./evaluation-openapi.js";

/** Nhận HTTP đã qua Auth và DTO, chuyển danh tính thật sang service hồ sơ
 * Controller không tính điểm hoặc tin unitId/giờ/trạng thái từ client để cấp quyền
 */
@ApiTags("Hồ sơ tự chấm")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 400, description: "Dữ liệu hoặc UUID không hợp lệ" })
@ApiResponse({ status: 401, description: "Cần đăng nhập bằng phiên hợp lệ" })
@ApiResponse({ status: 403, description: "Không có quyền hoặc đã khóa theo lịch/trạng thái" })
@ApiResponse({ status: 404, description: "Không tìm thấy hồ sơ trong phạm vi được phép" })
@ApiResponse({ status: 422, description: "Điểm hoặc hồ sơ chưa đáp ứng quy tắc nghiệp vụ", schema: { $ref: "#/components/schemas/ApiError" } })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "UNIT")
@Controller("api/v1/evaluations")
export class EvaluationsController {
  /** Inject tường minh để Nest nạp service đúng cả khi chạy ESM bằng tsx */
  constructor(@Inject(EvaluationsService) private readonly service: EvaluationsService) {}

  /** Chuyển bộ lọc đã kiểm và phiên sang use-case list, không nhận phạm vi UNIT tùy ý */
  @Get()
  @ApiOkResponse({ schema: { type: "object", properties: { items: { type: "array", items: evaluationMetadataSchema }, page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" } } } })
  @ApiOperation({ summary: "Danh sách hồ sơ theo quyền và trạng thái hiệu lực" })
  list(@Query() query: EvaluationQueryDto, @GetCurrentUser() user: CurrentUser) { return this.service.list(query, user); }

  /** Tạo bù idempotent, trả 200 cho cả lần đầu và retry để không ngụ ý tạo bản trùng */
  @Post()
  @HttpCode(200)
  @ApiBody({ type: CreateEvaluationDto })
  @ApiOkResponse({ schema: evaluationMetadataSchema })
  @ApiOperation({ summary: "Tạo bù hồ sơ và các điểm lá còn rỗng" })
  create(@Body() body: CreateEvaluationDto, @GetCurrentUser() user: CurrentUser) { return this.service.create(body, user); }

  /** Đọc chi tiết bằng UUID, projection giờ mở và quyền do service quyết định */
  @Get(":evaluationId")
  @ApiOkResponse({ schema: evaluationDetailSchema })
  @ApiOperation({ summary: "Chi tiết hồ sơ và quyền tự chấm từng tiêu chí" })
  detail(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @GetCurrentUser() user: CurrentUser) { return this.service.detail(id, user); }

  /** Chỉ trả tổng tự chấm và snapshot đã chốt, không dùng view tổng có điểm Admin */
  @Get(":evaluationId/score-summary")
  @ApiOkResponse({ schema: evaluationSummarySchema })
  @ApiOperation({ summary: "Tổng điểm và xếp loại tự chấm tạm tính từ máy chủ" })
  summary(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @GetCurrentUser() user: CurrentUser) { return this.service.summary(id, user); }

  /** Nhận một lá và DTO allowlist, guard chặn ADMIN trước khi service kiểm sở hữu */
  @Put(":evaluationId/scores/:criterionId/self")
  @Roles("UNIT")
  @ApiBody({ type: SelfScoreDto })
  @ApiOkResponse({ schema: savedSelfScoreSchema })
  @ApiOperation({ summary: "Lưu điểm hoặc diễn giải tự chấm một tiêu chí lá" })
  save(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Param("criterionId", new ParseUUIDPipe({ version: "4" })) criterionId: string, @Body() body: SelfScoreDto, @GetCurrentUser() user: CurrentUser) { return this.service.save(id, criterionId, body, user); }

  /** Kiểm nested DTO trước lưu từng ô độc lập, không trả thành công chung che lỗi từng lá */
  @Put(":evaluationId/scores/self-batch")
  @Roles("UNIT")
  @ApiBody({ type: BatchSelfScoreDto })
  @ApiOkResponse({ schema: batchSelfScoreSchema })
  @ApiOperation({ summary: "Lưu hàng loạt, trả kết quả riêng từng tiêu chí" })
  batch(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() body: BatchSelfScoreDto, @GetCurrentUser() user: CurrentUser) { return this.service.saveBatch(id, body, user); }

  /** Nộp sớm bằng body rỗng, dấu thời gian và trạng thái được server cấp trong transaction */
  @Post(":evaluationId/submit")
  @HttpCode(200)
  @Roles("UNIT")
  @ApiBody({ type: SubmitEvaluationDto })
  @ApiOkResponse({ schema: evaluationMetadataSchema })
  @ApiOperation({ summary: "Nộp hồ sơ tự chấm và khóa chỉnh sửa" })
  submit(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() _body: SubmitEvaluationDto, @GetCurrentUser() user: CurrentUser) { return this.service.submit(id, user); }
}
