import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GetCurrentUser } from "../../common/decorators/current-user.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { CreateCriterionDto } from "./dto/create-criterion.dto.js";
import { UpdateCriterionDto } from "./dto/update-criterion.dto.js";
import { CriteriaService } from "./criteria.service.js";

@ApiTags("Tiêu chí")
@ApiBearerAuth()
@Controller("api/v1/evaluation-periods/:periodId/criteria")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CriteriaController {
  constructor(private readonly criteriaService: CriteriaService) {}

  @Get()
  @Roles("ADMIN", "UNIT")
  @ApiOperation({ summary: "Xem cây tiêu chí của kỳ đánh giá" })
  @ApiResponse({ status: 200, description: "Cây tiêu chí theo quyền và thời điểm mở của kỳ" })
  /** Trả cây tiêu chí của kỳ sau khi service áp dụng chính sách công bố theo server
   * periodId là UUID từ route còn user đến từ access token đã xác thực
   * Trước giờ mở, service từ chối UNIT và vẫn trả cấu hình đầy đủ cho Admin
   */
  findByPeriod(@Param("periodId", ParseUUIDPipe) periodId: string, @GetCurrentUser() user: CurrentUser) {
    return this.criteriaService.findByPeriod(periodId, user);
  }

  @Post()
  @Roles("ADMIN")
  @ApiOperation({ summary: "Thêm tiêu chí vào kỳ đánh giá" })
  @ApiResponse({ status: 201, description: "Tiêu chí đã được tạo" })
  /** Tạo tiêu chí trong kỳ lấy từ route và dùng Admin hiện tại làm actor audit
   * periodId được UUID kiểm tra trước, dto chứa riêng các field tiêu chí
   * Service khóa thao tác sau khi công bố và xác nhận tiêu chí cha cùng kỳ
   */
  create(
    @Param("periodId", ParseUUIDPipe) periodId: string,
    @Body() dto: CreateCriterionDto,
    @GetCurrentUser() user: CurrentUser,
  ) {
    return this.criteriaService.create(periodId, dto, user.id);
  }

  @Patch(":id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Cập nhật tiêu chí trong kỳ đánh giá" })
  @ApiResponse({ status: 200, description: "Tiêu chí đã được cập nhật" })
  /** Cập nhật tiêu chí nháp và chuyển danh tính Admin để lưu audit
   * id là UUID của tiêu chí, dto chỉ chứa nội dung được phép sửa
   * Service tự kiểm tra khóa công bố và quan hệ cha thuộc cùng kỳ
   */
  update(@Param("periodId", ParseUUIDPipe) periodId: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCriterionDto, @GetCurrentUser() user: CurrentUser) {
    return this.criteriaService.update(periodId, id, dto, user.id);
  }

  @Delete(":id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Xóa tiêu chí nháp" })
  @ApiResponse({ status: 200, description: "Tiêu chí đã được xóa" })
  /** Xóa tiêu chí khi không còn dữ liệu phụ thuộc và ghi nhận actor
   * id là UUID của tiêu chí, user là Admin đã được xác thực
   * Service từ chối khi kỳ đã công bố hoặc tiêu chí đang có con/điểm
   */
  remove(@Param("periodId", ParseUUIDPipe) periodId: string, @Param("id", ParseUUIDPipe) id: string, @GetCurrentUser() user: CurrentUser) {
    return this.criteriaService.remove(periodId, id, user.id);
  }
}
