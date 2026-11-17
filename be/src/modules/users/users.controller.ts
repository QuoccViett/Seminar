import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { GetCurrentUser } from "../../common/decorators/current-user.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { UpdateUserDto } from "./dto/update-user.dto.js";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto.js";
import { UsersService } from "./users.service.js";
import { CredentialDispatchService } from "../notifications/credential-dispatch.service.js";
import { ConfirmCredentialEmailDto } from "./dto/confirm-credential-email.dto.js";

/** Đổi lỗi UUID của route credential sang tiếng Việt và giữ field kỹ thuật cho FE */
const credentialUserIdPipe = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ code: "VALIDATION_ERROR", message: "Mã tài khoản không hợp lệ.", details: [{ field: "id", messages: ["id phải là UUID hợp lệ."] }] }) });

@ApiTags("Users")
@ApiBearerAuth("access-token")
@Controller("api/v1/users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: UsersService,
    @Optional() @Inject(CredentialDispatchService) private readonly credentials?: CredentialDispatchService,
  ) {}

  @Get()
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Danh sách tài khoản, lọc và phân trang" })
  @ApiQuery({ name: "page", required: false, example: 1 })
  @ApiQuery({ name: "pageSize", required: false, example: 20 })
  @ApiQuery({ name: "role", required: false, enum: ["ADMIN", "UNIT"] })
  @ApiQuery({ name: "unitId", required: false })
  @ApiQuery({ name: "isActive", required: false, enum: ["true", "false"] })
  @ApiQuery({ name: "q", required: false, description: "Tìm tên đăng nhập, họ tên hoặc email" })
  /** Chuyển bộ lọc danh sách tới service sau khi guard đã xác nhận vai trò ADMIN
   * Kết quả chỉ chứa các trường hồ sơ công khai và phân trang theo contract
   */
  findAll(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("role") role?: string,
    @Query("unitId") unitId?: string,
    @Query("isActive") isActive?: string,
    @Query("q") q?: string,
  ) {
    return this.usersService.findAll({ page, pageSize, role, unitId, isActive, q });
  }

  @Post()
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Tạo tài khoản ADMIN hoặc UNIT (trả mật khẩu tạm một lần)" })
  @ApiBody({ type: CreateUserDto })
  /** Tạo tài khoản bằng mật khẩu cấu hình và gắn ADMIN hiện tại vào audit
   * Mật khẩu tạm chỉ xuất hiện trong phản hồi cấp mới, chưa xác nhận đã gửi
   */
  create(@Body() dto: CreateUserDto, @GetCurrentUser() currentUser: CurrentUser) {
    return this.usersService.create(dto, currentUser.id);
  }

  @Get(":id")
  @Roles("ADMIN", "UNIT")
  @ApiParam({ name: "id", format: "uuid", description: "UUID của TÀI KHOẢN: lấy từ GET /users, ở trường id của từng dòng (không phải unitId)" })
  @ApiOperation({ summary: "[ADMIN, UNIT] Xem thông tin tài khoản (UNIT chỉ xem chính mình)" })
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @GetCurrentUser() currentUser: CurrentUser,
  ) {
    return this.usersService.findOne(id, currentUser);
  }

  @Patch(":id")
  @Roles("ADMIN", "UNIT")
  @ApiParam({ name: "id", format: "uuid", description: "UUID của TÀI KHOẢN: lấy từ GET /users, ở trường id của từng dòng (không phải unitId)" })
  @ApiOperation({ summary: "[ADMIN, UNIT] Cập nhật thông tin tài khoản (UNIT chỉ sửa chính mình)" })
  @ApiBody({ type: UpdateUserDto })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @GetCurrentUser() currentUser: CurrentUser,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, currentUser, dto);
  }

  @Post(":id/reset-password")
  @HttpCode(HttpStatus.OK)
  @Roles("ADMIN")
  @ApiParam({ name: "id", format: "uuid", description: "UUID của TÀI KHOẢN: lấy từ GET /users, ở trường id của từng dòng (không phải unitId" })
  @ApiOperation({ summary: "[ADMIN] Đặt lại mật khẩu cho UNIT nếu quên mật khẩu và thu hồi phiên cũ" })
  /** Đặt lại mật khẩu bằng giá trị cấu hình và ghi người thao tác vào audit
   * Service tăng phiên bản để token trước đó mất hiệu lực
   */
  resetPassword(@Param("id", ParseUUIDPipe) id: string, @GetCurrentUser() currentUser: CurrentUser) {
    return this.usersService.resetPassword(id, currentUser.id);
  }

  /** Trả trạng thái gửi từng kênh cho Admin, không trả payload hay địa chỉ đã mã hóa */
  @Get(":id/credential-deliveries")
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Trạng thái cấp thông tin đăng nhập theo kênh" })
  credentialStatus(@Param("id", credentialUserIdPipe) id: string) { return this.credentials!.status(id); }

  /** Ghi xác nhận email của Admin trước khi worker được gửi mật khẩu ban đầu tới địa chỉ này */
  @Post(":id/credential-deliveries/confirm-email")
  @HttpCode(HttpStatus.OK)
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Xác nhận email nhận thông tin đăng nhập" })
  confirmCredentialEmail(@Param("id", credentialUserIdPipe) id: string, @Body() body: ConfirmCredentialEmailDto, @GetCurrentUser() user: CurrentUser) { return this.credentials!.confirmEmail(id, body.email, user.id); }

  @Patch(":id/status")
  @Roles("ADMIN")
  @ApiParam({ name: "id", format: "uuid", description: "UUID của TÀI KHOẢN: lấy từ GET /users, ở trường id của từng dòng (không phải unitId" })
  @ApiOperation({ summary: "[ADMIN] Khóa hoặc kích hoạt tài khoản" })
  @ApiBody({ type: UpdateUserStatusDto })
  updateStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @GetCurrentUser() currentUser: CurrentUser,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateStatus(id, dto.isActive, currentUser);
  }
}
