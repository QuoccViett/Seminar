import {
  Controller,
  Get,
  Header,
  Inject,
  BadRequestException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { DashboardDeductionsDto, DashboardDeductionDetailDto } from "./dto/dashboard-deductions.dto.js";
import { DashboardLeaderboardDto } from "./dto/leaderboard.dto.js";
import { DashboardOverviewDto } from "./dto/dashboard-overview.dto.js";
import { DashboardScoreDistributionDto } from "./dto/score-distribution.dto.js";
import { DashboardService } from "./dashboard.service.js";
import { ERROR_CODES } from "../../common/constants/error-codes.js";

const periodIdPipe = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: "Mã kỳ đánh giá không hợp lệ" }) });
const criterionIdPipe = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: "Mã tiêu chí không hợp lệ" }) });

@ApiTags("Dashboard")
@ApiBearerAuth("access-token")
@Controller("api/v1/admin/dashboard")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class DashboardController {
  constructor(
    @Inject(DashboardService)
    private readonly dashboardService: DashboardService
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Tổng quan dashboard của một đợt đánh giá" })
  @ApiQuery({ name: "periodId", required: true, format: "uuid" })
  @ApiOkResponse({ type: DashboardOverviewDto })
  getOverview(@Query("periodId", periodIdPipe) periodId: string) {
    return this.dashboardService.getOverview(periodId);
  }

  @Get("criteria-deductions")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Danh sách tiêu chí bị Admin trừ điểm" })
  @ApiQuery({ name: "periodId", required: true, format: "uuid" })
  @ApiOkResponse({ type: DashboardDeductionsDto })
  getDeductions(@Query("periodId", periodIdPipe) periodId: string) {
    return this.dashboardService.getDeductions(periodId);
  }

  @Get("criteria-deductions/:criterionId")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Chi tiết đơn vị bị trừ điểm ở một tiêu chí đã chốt" })
  @ApiQuery({ name: "periodId", required: true, format: "uuid" })
  @ApiOkResponse({ type: DashboardDeductionDetailDto })
  /** Chỉ Admin xem drill-down của tiêu chí thuộc kỳ, UUID sai bị chặn trước service */
  getDeductionDetail(@Query("periodId", periodIdPipe) periodId: string, @Param("criterionId", criterionIdPipe) criterionId: string) {
    return this.dashboardService.getDeductionDetail(periodId, criterionId);
  }

  @Get("leaderboard")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Bảng xếp hạng thời gian thực của một đợt đánh giá" })
  @ApiQuery({ name: "periodId", required: true, format: "uuid" })
  @ApiOkResponse({ type: DashboardLeaderboardDto })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "Số hồ sơ từ 1 đến 100" })
  /** Đọc bảng xếp hạng theo kỳ và giới hạn để không tải toàn bộ hồ sơ trên trang tổng quan */
  getLeaderboard(
    @Query("periodId", periodIdPipe) periodId: string,
    @Query("limit") rawLimit?: string,
  ) {
    // Chuỗi query phải là số nguyên thập phân để tránh parseInt chấp nhận phần dư như 20abc
    if (rawLimit !== undefined && !/^\d+$/.test(rawLimit)) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: "Giới hạn bảng xếp hạng phải là số nguyên từ 1 đến 100" });
    }
    return this.dashboardService.getLeaderboard(periodId, rawLimit === undefined ? 20 : Number(rawLimit));
  }

  @Get("score-distribution")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Phân bố xếp loại của các hồ sơ đã chốt" })
  @ApiQuery({ name: "periodId", required: true, format: "uuid" })
  @ApiOkResponse({ type: DashboardScoreDistributionDto })
  getScoreDistribution(@Query("periodId", periodIdPipe) periodId: string) {
    return this.dashboardService.getScoreDistribution(periodId);
  }
}
