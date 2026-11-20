import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { GetCurrentUser } from "../../common/decorators/current-user.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { CreateEvaluationPeriodDto } from "./dto/create-evaluation-period.dto.js";
import { UpdateEvaluationPeriodDto } from "./dto/update-evaluation-period.dto.js";
import { UpsertRatingThresholdDto } from "./dto/upsert-rating-threshold.dto.js";
import { EvaluationPeriodsService } from "./evaluation-periods.service.js";
import { ApiArrayValidationPipe } from "../../common/pipes/api-validation.pipe.js";
import { PeriodWorkflowService } from "./period-workflow.service.js";
import { TransitionPhaseDto } from "./dto/transition-phase.dto.js";
import { PreviewSupplementScheduleDto } from "./dto/preview-supplement-schedule.dto.js";

@ApiTags("Evaluation Periods")
@ApiBearerAuth("access-token")
@Controller("api/v1/evaluation-periods")
@UseGuards(JwtAuthGuard, RolesGuard)
export class EvaluationPeriodsController {
  /** Nhận service cấu hình và workflow để các route dùng chung policy nghiệp vụ
   * Controller chỉ xác thực input/actor, không tự cập nhật phase hoặc tính lịch
   */
  constructor(
    private readonly evaluationPeriodsService: EvaluationPeriodsService,
    private readonly workflow: PeriodWorkflowService,
  ) {}

  /** Xem trước lịch bổ sung tạm bằng giờ Việt Nam, không tạo yêu cầu cho đơn vị
   * Body chỉ nhận mốc mở có múi giờ, service tự tính hạn và từ chối cuối tuần
   * Route chuyên dụng đặt trước route UUID để không nhầm preview thành mã kỳ
   */
  @Post("supplement-schedule/preview")
  @Roles("ADMIN")
  @HttpCode(200)
  @ApiOperation({ summary: "[ADMIN] Xem trước giờ mở và hạn bổ sung theo lịch tạm của ngày Việt Nam" })
  previewSupplement(@Body() dto: PreviewSupplementScheduleDto) {
    return this.workflow.previewSupplement(dto.supplementStartAt);
  }

  /** Đọc các đích giai đoạn được phép theo điều kiện do backend kiểm tra
   * id là UUID kỳ, kết quả chỉ dùng hiển thị vì lệnh ghi phải kiểm lại sau khóa
   */
  @Get(":id/phase-options")
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Xem các giai đoạn có thể chuyển tới và điều kiện còn thiếu" })
  phaseOptions(@Param("id", ParseUUIDPipe) id: string) {
    return this.workflow.options(id);
  }

  /** Chuyển giai đoạn theo đồ thị có điều kiện thay cho nhận phase qua PATCH
   * dto chỉ mang đích, user.id lấy từ JWT còn giờ và dấu chốt do server cấp
   * Service khóa kỳ/hồ sơ và giữ audit, history, thông báo trong cùng transaction
   */
  @Post(":id/transition-phase")
  @Roles("ADMIN")
  @HttpCode(200)
  @ApiOperation({ summary: "[ADMIN] Chuyển giai đoạn kỳ đánh giá khi đáp ứng các điều kiện nghiệp vụ" })
  transition(@Param("id", ParseUUIDPipe) id: string, @Body() dto: TransitionPhaseDto, @GetCurrentUser() user: CurrentUser) {
    return this.workflow.transition(id, dto.phase, user.id);
  }

  @Get()
  @Roles("ADMIN", "UNIT")
  @ApiOperation({ summary: "[ADMIN, UNIT] Xem danh sách đợt đánh giá (UNIT chỉ thấy kỳ đã công bố)" })
  @ApiResponse({ status: 200, description: "Danh sách đợt đánh giá kèm ngưỡng xếp loại" })
  @ApiQuery({ name: "page", required: false, type: Number, example: 1 })
  @ApiQuery({ name: "pageSize", required: false, type: Number, example: 20 })
  @ApiQuery({ name: "sortBy", required: false, type: String, enum: ["createdAt", "year", "name", "phase"] })
  @ApiQuery({ name: "sortOrder", required: false, type: String, enum: ["asc", "desc"], example: "desc" })
  /** Chuyển bộ lọc phân trang và người dùng đã xác thực tới service
   * query là dữ liệu phân trang, user được guard gắn từ access token
   * Service dùng vai trò và giờ server để ẩn cấu hình trước thời điểm mở
   */
  findAll(@Query() query: PaginationQueryDto, @GetCurrentUser() user: CurrentUser) {
    return this.evaluationPeriodsService.findAll(query, user);
  }

  @Get(":id")
  @Roles("ADMIN", "UNIT")
  @ApiOperation({ summary: "[ADMIN, UNIT] Xem chi tiết đợt đánh giá theo quyền và thời điểm mở" })
  @ApiResponse({ status: 200, description: "Thông tin chi tiết đợt đánh giá" })
  @ApiResponse({ status: 404, description: "Không tìm thấy đợt đánh giá" })
  /** Đọc chi tiết kỳ theo vai trò của người gọi đã được guard xác thực
   * id được ParseUUIDPipe kiểm tra trước khi gọi service
   * Service trả metadata kỳ nhưng chỉ lộ tiêu chí sau công bố và đến giờ mở
   */
  findOne(@Param("id", ParseUUIDPipe) id: string, @GetCurrentUser() user: CurrentUser) {
    return this.evaluationPeriodsService.findOne(id, user);
  }

  @Get(":id/thresholds")
  @Roles("ADMIN", "UNIT")
  @ApiOperation({ summary: "[ADMIN, UNIT] Xem ngưỡng xếp loại theo quyền và thời điểm mở của kỳ" })
  @ApiResponse({ status: 200, description: "Bộ ngưỡng theo quyền và thời điểm mở" })
  /** Đọc riêng bộ ngưỡng qua cùng bộ lọc quyền của chi tiết kỳ
   * id là UUID kỳ và user là người dùng đã được JWT guard xác thực
   * UNIT nhận lỗi không tìm thấy trước công bố và mảng rỗng trước giờ mở
   */
  getThresholds(@Param("id", ParseUUIDPipe) id: string, @GetCurrentUser() user: CurrentUser) {
    return this.evaluationPeriodsService.getThresholds(id, user);
  }

  @Post()
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Tạo đợt đánh giá ở trạng thái nháp" })
  @ApiResponse({ status: 201, description: "Tạo đợt đánh giá thành công" })
  /** Tạo nháp từ cấu hình đã qua DTO và danh tính Admin thật
   * Service cấp phase và dấu thời gian, không nhận các giá trị hệ thống qua body
   */
  create(@GetCurrentUser() user: CurrentUser, @Body() dto: CreateEvaluationPeriodDto) {
    return this.evaluationPeriodsService.create(user.id, dto);
  }

  @Patch(":id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Cập nhật cấu hình đợt đánh giá trước khi kỳ mở" })
  @ApiResponse({ status: 200, description: "Cập nhật đợt đánh giá thành công" })
  @ApiResponse({ status: 404, description: "Không tìm thấy đợt đánh giá" })
  /** Chuyển dữ liệu chỉnh sửa cùng danh tính Admin để service kiểm tra lịch và audit
   * id là mã kỳ hợp lệ, dto là các field cấu hình được phép cập nhật
   * Không nhận phase/publishedAt từ client vì đó là trạng thái do nghiệp vụ quản lý
   */
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateEvaluationPeriodDto,
    @GetCurrentUser() user: CurrentUser,
  ) {
    return this.evaluationPeriodsService.update(id, dto, user.id);
  }

  @Post(":id/publish")
  @Roles("ADMIN")
  @HttpCode(200)
  @ApiOperation({ summary: "[ADMIN] Công bố đợt đánh giá sau khi cấu hình vượt qua kiểm tra" })
  @ApiResponse({ status: 200, description: "Kỳ đánh giá đã được công bố" })
  /** Công bố cấu hình bằng thao tác tường minh thay vì nhận publishedAt từ request
   * id là kỳ cần công bố, user là Admin do JWT guard xác thực
   * Service kiểm lịch, đủ ngưỡng và tiêu chí trước khi gắn thời điểm công bố
   */
  publish(@Param("id", ParseUUIDPipe) id: string, @GetCurrentUser() user: CurrentUser) {
    return this.evaluationPeriodsService.publish(id, user.id);
  }

  @Get(":id/publish-check")
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Kiểm tra các điều kiện cần hoàn tất trước khi công bố kỳ" })
  @ApiResponse({ status: 200, description: "Danh sách điều kiện công bố và trạng thái từng điều kiện" })
  /** Trả danh sách điều kiện còn thiếu để Admin hoàn thiện cấu hình trước công bố
   * id là UUID kỳ, quyền Admin được xác nhận bằng RolesGuard
   * Kết quả chỉ để hướng dẫn; POST publish luôn kiểm tra lại trước khi ghi
   */
  getPublishCheck(@Param("id", ParseUUIDPipe) id: string) {
    return this.evaluationPeriodsService.getPublishCheck(id);
  }

  @Delete(":id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Xóa đợt đánh giá nháp chưa phát sinh hồ sơ hoặc báo cáo" })
  @ApiResponse({ status: 200, description: "Xóa đợt đánh giá thành công" })
  @ApiResponse({ status: 400, description: "Đợt đánh giá đã có dữ liệu, không thể xóa" })
  @ApiResponse({ status: 404, description: "Không tìm thấy đợt đánh giá" })
  /** Xóa kỳ nháp theo UUID cùng danh tính Admin để ghi audit trong transaction
   * Service khóa kỳ trước khi kiểm tra quan hệ và không xóa kỳ đã công bố
   */
  remove(@Param("id", ParseUUIDPipe) id: string, @GetCurrentUser() user: CurrentUser) {
    return this.evaluationPeriodsService.remove(id, user.id);
  }

  @Put(":id/thresholds")
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Tạo hoặc thay thế bộ ngưỡng xếp loại của kỳ chưa công bố" })
  @ApiBody({
    description: "Gửi đủ bốn mức chuẩn. minPercent và minExclusive phải theo đúng mức; chỉ label và color được tùy chỉnh.",
    schema: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        required: ["rating", "label", "minPercent"],
        properties: {
          rating: { type: "string", enum: ["EXCELLENT", "GOOD", "PASS", "FAIL"] },
          label: { type: "string", example: "Xuất sắc" },
          minPercent: { type: "number", enum: [85, 65, 50, 0] },
          minExclusive: { type: "boolean", description: "true cho EXCELLENT; false cho các mức còn lại" },
          color: { type: "string", nullable: true, example: "#16a34a" },
        },
      },
      example: [
        { rating: "EXCELLENT", label: "Xuất sắc", minPercent: 85, minExclusive: true, color: "#16a34a" },
        { rating: "GOOD", label: "Tốt", minPercent: 65, minExclusive: false, color: "#2563eb" },
        { rating: "PASS", label: "Đạt", minPercent: 50, minExclusive: false, color: "#d97706" },
        { rating: "FAIL", label: "Chưa đạt", minPercent: 0, minExclusive: false, color: "#dc2626" },
      ],
    },
  })
  @ApiResponse({ status: 200, description: "Cập nhật ngưỡng xếp loại thành công" })
  /** Kiểm từng ngưỡng trong mảng trước khi lưu, giữ chỉ số khi báo lỗi trường
   * Không thay hình dạng body để các client đang gửi mảng tiếp tục hoạt động
   */
  /** Gửi trọn bộ ngưỡng cùng danh tính Admin để thay thế cấu hình hiện tại
   * id là kỳ đích, thresholds là mảng đã xác thực từng phần tử
   * Service kiểm đủ bốn ngưỡng chuẩn, khóa sau công bố và ghi audit
   */
  upsertThresholds(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ApiArrayValidationPipe(UpsertRatingThresholdDto)) thresholds: UpsertRatingThresholdDto[],
    @GetCurrentUser() user: CurrentUser,
  ) {
    return this.evaluationPeriodsService.upsertThresholds(id, thresholds, user.id);
  }
}
