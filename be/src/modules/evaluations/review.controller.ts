import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GetCurrentUser, type CurrentUser } from "../../common/decorators/current-user.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { BatchFinalizeDto, BatchReviewDto, ReviewScoreDto, SupplementRequestDto } from "./dto/review.dto.js";
import { ReviewService } from "./review.service.js";
import { SubmitEvaluationDto } from "./dto/evaluation.dto.js";
import { EvaluationsService } from "./evaluations.service.js";
import { evaluationDetailSchema } from "./evaluation-openapi.js";

/** Chỉ chuyển yêu cầu ADMIN đã xác thực và UUID hợp lệ sang service thẩm định */
@ApiTags("Evaluation Reviews")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 400, description: "Dữ liệu gửi lên hoặc UUID không hợp lệ" })
@ApiResponse({ status: 403, description: "Không có quyền hoặc hồ sơ đang khóa thẩm định" })
@ApiResponse({ status: 409, description: "Hồ sơ đã có vòng bổ sung với nội dung khác" })
@ApiResponse({ status: 422, description: "Điểm hoặc hồ sơ chưa đáp ứng quy tắc nghiệp vụ" })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
@Controller("api/v1/admin/evaluations")
export class ReviewController {
  /** Tiêm tường minh để Nest khởi tạo đúng trong môi trường ESM */
  constructor(@Inject(ReviewService) private readonly service: ReviewService, @Inject(EvaluationsService) private readonly evaluations: EvaluationsService) {}

  /** Đọc cây so sánh và baseline chỉ dành cho Admin, reconcile hạn trước khi trả quyền
   * Dùng projection hồ sơ chung để metadata minh chứng và lịch luôn cùng quy tắc bảo mật
   */
  @Get(":evaluationId/review")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ schema: evaluationDetailSchema })
  @ApiOperation({ summary: "[ADMIN] Xem và đối chiếu nội dung tự chấm, thẩm định và bổ sung của hồ sơ" })
  detail(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @GetCurrentUser() user: CurrentUser) {
    return this.evaluations.detail(id, user);
  }

  /** Nhận điểm của một lá, người duyệt lấy từ phiên thay vì body */
  @Put(":evaluationId/scores/:criterionId/review")
  @ApiBody({ type: ReviewScoreDto })
  @ApiOperation({ summary: "[ADMIN] Ghi điểm và nhận xét thẩm định cho một tiêu chí lá" })
  review(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Param("criterionId", new ParseUUIDPipe({ version: "4" })) criterionId: string, @Body() body: ReviewScoreDto, @GetCurrentUser() user: CurrentUser) {
    return this.service.review(id, criterionId, body, user);
  }

  /** Chấp nhận các ô chưa duyệt có điểm tự chấm, giữ nguyên ô đã thẩm định
   * Body rỗng được validation kiểm, service khóa lại và ghi audit cho từng ô
   */
  @Post(":evaluationId/accept-all")
  @HttpCode(200)
  @ApiBody({ type: SubmitEvaluationDto })
  @ApiOperation({ summary: "[ADMIN] Chấp nhận các điểm tự chấm chưa được thẩm định của hồ sơ" })
  acceptAll(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() _body: SubmitEvaluationDto, @GetCurrentUser() user: CurrentUser) {
    return this.service.acceptAll(id, user);
  }

  /** Ghi thời điểm hoàn tất lượt đầu sau khi mọi lá đã được thẩm định
   * Lệnh không tự chuyển phase hay chốt kết quả và trả cùng thời điểm khi gọi lại
   */
  @Post(":evaluationId/first-review-complete")
  @HttpCode(200)
  @ApiBody({ type: SubmitEvaluationDto })
  @ApiOperation({ summary: "[ADMIN] Hoàn tất lượt thẩm định đầu tiên của hồ sơ" })
  completeFirstReview(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() _body: SubmitEvaluationDto, @GetCurrentUser() user: CurrentUser) {
    return this.service.completeFirstReview(id, user);
  }

  /** Yêu cầu chốt một hồ sơ bằng kết quả do máy chủ tính trong transaction
   * Body rỗng không thể chỉ định tổng điểm, xếp loại hoặc người chốt
   */
  @Post(":evaluationId/finalize")
  @HttpCode(200)
  @ApiBody({ type: SubmitEvaluationDto })
  @ApiOperation({ summary: "[ADMIN] Chốt kết quả cuối cùng cho một hồ sơ đủ điều kiện" })
  finalize(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() _body: SubmitEvaluationDto, @GetCurrentUser() user: CurrentUser) {
    return this.service.finalize(id, user);
  }

  /** Nhận một lịch mở và ghi chú riêng từng lá để tạo duy nhất một vòng bổ sung
   * Service tính hạn sau khóa và dùng snapshot đã lưu cho lần gọi lại
   */
  @Post(":evaluationId/supplement-request")
  @HttpCode(200)
  @ApiBody({ type: SupplementRequestDto })
  @ApiOperation({ summary: "[ADMIN] Yêu cầu đơn vị bổ sung các tiêu chí được chọn theo lịch đã xem trước" })
  requestSupplement(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() body: SupplementRequestDto, @GetCurrentUser() user: CurrentUser) {
    return this.service.requestSupplement(id, body, user);
  }

  /** Lưu nhiều ô độc lập, kết quả từng ô được trả theo thứ tự đầu vào
   * Mỗi ô đi qua cùng kiểm tra và transaction như endpoint thẩm định đơn
   */
  @Put(":evaluationId/scores/review-batch")
  @ApiBody({ type: BatchReviewDto })
  @ApiOperation({ summary: "[ADMIN] Thẩm định hàng loạt tiêu chí và nhận kết quả riêng từng mục" })
  batchReview(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() body: BatchReviewDto, @GetCurrentUser() user: CurrentUser) {
    return this.service.batchReview(id, body, user);
  }

  /** Chốt hàng loạt bằng các transaction riêng để một hồ sơ lỗi không hủy hồ sơ khác
   * Người gọi phải đọc kết quả từng hồ sơ, HTTP thành công không đảm bảo mọi mục đạt
   */
  @Post("finalize-batch")
  @HttpCode(200)
  @ApiBody({ type: BatchFinalizeDto })
  @ApiOperation({ summary: "[ADMIN] Chốt hàng loạt hồ sơ với kết quả riêng cho từng hồ sơ" })
  batchFinalize(@Body() body: BatchFinalizeDto, @GetCurrentUser() user: CurrentUser) {
    return this.service.batchFinalize(body, user);
  }

  /** Xem tổng và điều kiện chốt trước khi xác nhận, server kiểm lại khi thực ghi
   * Danh sách và kết quả giữ thứ tự, một hồ sơ không tồn tại không che hồ sơ khác
   */
  @Post("finalize-preview")
  @HttpCode(200)
  @ApiBody({ type: BatchFinalizeDto })
  @ApiOperation({ summary: "[ADMIN] Xem trước điều kiện và kết quả dự kiến khi chốt hàng loạt hồ sơ" })
  previewFinalize(@Body() body: BatchFinalizeDto, @GetCurrentUser() user: CurrentUser) {
    return this.service.previewFinalize(body, user);
  }
}
