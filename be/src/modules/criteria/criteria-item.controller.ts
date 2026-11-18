import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { GetCurrentUser } from "../../common/decorators/current-user.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { CriteriaService } from "./criteria.service.js";
import { UpdateCriterionDto } from "./dto/update-criterion.dto.js";

/** Cung cấp route sửa/xóa tiêu chí theo UUID, giữ route lồng để tương thích
 * Chỉ Admin được dùng, không tạo đường GET có thể bỏ qua projection trước mở
 */
@ApiTags("Tiêu chí")
@ApiBearerAuth()
@Controller("api/v1/criteria")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class CriteriaItemController {
  /** Nhận service hiện có qua DI để cả route phẳng và lồng dùng chung khóa và audit */
  constructor(private readonly criteria: CriteriaService) {}

  /** Sửa tiêu chí theo mã, server tự xác định kỳ và khóa lại trước ghi
   * id qua UUID pipe, dto không cho đổi kỳ, actor lấy từ JWT đã kiểm quyền
   */
  @Patch(":id")
  @ApiOperation({ summary: "Sửa tiêu chí nháp theo mã tiêu chí" })
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCriterionDto, @GetCurrentUser() user: CurrentUser) {
    return this.criteria.updateById(id, dto, user.id);
  }

  /** Xóa tiêu chí theo mã bằng cùng use-case kiểm công bố, con và điểm phụ thuộc
   * Service vẫn đọc lại tiêu chí sau khóa để bảo vệ dữ liệu khi có thao tác cạnh tranh
   */
  @Delete(":id")
  @ApiOperation({ summary: "Xóa tiêu chí nháp theo mã tiêu chí" })
  remove(@Param("id", ParseUUIDPipe) id: string, @GetCurrentUser() user: CurrentUser) {
    return this.criteria.removeById(id, user.id);
  }
}
