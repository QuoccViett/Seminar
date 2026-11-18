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
  ApiOperation,
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

@ApiTags("Đợt đánh giá")
@ApiBearerAuth()
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
  @ApiOperation({ summary: "Xem trước lịch bổ sung tạm theo ngày Việt Nam" })
  previewSupplement(@Body() dto: PreviewSupplementScheduleDto) {
    return this.workflow.previewSupplement(dto.supplementStartAt);
  }

  /** Đọc các đích giai đoạn được phép theo điều kiện do backend kiểm tra
   * id là UUID kỳ, kết quả chỉ dùng hiển thị vì lệnh ghi phải kiểm lại sau khóa
   */
  @Get(":id/phase-options")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Xem điều kiện chuyển giai đoạn kỳ đánh giá" })
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
  @ApiOperation({ summary: "Chuyển giai đoạn kỳ đánh giá theo điều kiện nghiệp vụ" })
  transition(@Param("id", ParseUUIDPipe) id: string, @Body() dto: TransitionPhaseDto, @GetCurrentUser() user: CurrentUser) {
    return this.workflow.transition(id, dto.phase, user.id);
  }

  @Get()
  @Roles("ADMIN", "UNIT")
  @ApiOperation({ summary: "Danh sách đợt đánh giá" })
  @ApiResponse({ status: 200, description: "Danh sách đợt đánh giá kèm ngưỡng xếp loại" })
  /** Chuyển bộ lọc phân trang và người dùng đã xác thực tới service
   * query là dữ liệu phân trang, user được guard gắn từ access token
   * Service dùng vai trò và giờ server để ẩn cấu hình trước thời điểm mở
   */
  findAll(@Query() query: PaginationQueryDto, @GetCurrentUser() user: CurrentUser) {
    return this.evaluationPeriodsService.findAll(query, user);
  }

  @Get(":id")
  @Roles("ADMIN", "UNIT")
  @ApiOperation({ summary: "Xem chi tiết đợt đánh giá" })
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
  @ApiOperation({ summary: "Xem ngưỡng xếp loại của kỳ" })
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
  @ApiOperation({ summary: "Tạo đợt đánh giá" })
  @ApiResponse({ status: 201, description: "Tạo đợt đánh giá thành công" })
  /** Tạo nháp từ cấu hình đã qua DTO và danh tính Admin thật
   * Service cấp phase và dấu thời gian, không nhận các giá trị hệ thống qua body
   */
  create(@GetCurrentUser() user: CurrentUser, @Body() dto: CreateEvaluationPeriodDto) {
    return this.evaluationPeriodsService.create(user.id, dto);
  }

  @Patch(":id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Cập nhật đợt đánh giá" })
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
  @ApiOperation({ summary: "Công bố kỳ đánh giá đã cấu hình" })
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
  @ApiOperation({ summary: "Kiểm tra điều kiện công bố kỳ" })
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
  @ApiOperation({ summary: "Xóa đợt đánh giá" })
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
  @ApiOperation({ summary: "Tạo hoặc cập nhật ngưỡng xếp loại" })
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
