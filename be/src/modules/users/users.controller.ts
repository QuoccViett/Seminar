import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { Res } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
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
import { UserImportService } from "./user-import.service.js";
import { RetryCredentialDeliveryDto } from "./dto/retry-credential-delivery.dto.js";

/** Đổi lỗi UUID của route credential sang tiếng Việt và giữ field kỹ thuật cho FE */
const credentialUserIdPipe = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ code: "VALIDATION_ERROR", message: "Mã tài khoản không hợp lệ.", details: [{ field: "id", messages: ["id phải là UUID hợp lệ."] }] }) });
/** Kiểm UUID của phiên import và giữ đúng tên field để FE gắn lỗi vào thao tác đang thực hiện */
const importSessionIdPipe = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ code: "VALIDATION_ERROR", message: "Mã phiên nhập không hợp lệ.", details: [{ field: "importId", messages: ["importId phải là UUID hợp lệ."] }] }) });

@ApiTags("Users")
@ApiBearerAuth("access-token")
@Controller("api/v1/users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: UsersService,
    @Inject(UserImportService) private readonly userImport: UserImportService,
    @Optional() @Inject(CredentialDispatchService) private readonly credentials?: CredentialDispatchService,
  ) {}

  /** Trả workbook XLSX mẫu cho quản trị viên tải về
   * Đầu vào không có; đầu ra là byte file với MIME và tên cố định để trình duyệt tải xuống
   * Header/cột được UserImportService sinh cùng nguồn với parser nhằm tránh lệch cấu trúc
   */
  @Get("import/template")
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Tải tệp mẫu nhập tài khoản UNIT" })
  async importTemplate(@Res() response: Response): Promise<void> {
    const buffer = await this.userImport.createTemplate();
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", 'attachment; filename="mau-nhap-tai-khoan-unit.xlsx"');
    response.setHeader("Content-Length", buffer.length);
    response.status(HttpStatus.OK).send(buffer);
  }

  /** Nhận một upload XLSX giới hạn bộ nhớ và tạo preview do Admin sở hữu
   * Đầu vào là field multipart file, Idempotency-Key và actor từ Bearer; đầu ra là các dòng chuẩn hóa/lỗi
   * Multer cắt file quá lớn trước khi service đọc; guard/controller kiểm role trước lưu bất kỳ phiên nào
   * Route không tạo Unit/User và không gọi provider, kể cả khi tệp hợp lệ
   */
  @Post("import/preview")
  @Roles("ADMIN")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @ApiOperation({ summary: "[ADMIN] Kiểm tra và xem trước tệp Excel tài khoản UNIT" })
  @ApiConsumes("multipart/form-data")
  @ApiHeader({ name: "Idempotency-Key", required: true, description: "Khóa ổn định cho một lần xem trước và retry cùng tệp" })
  @ApiBody({ schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } })
  previewImport(
    @UploadedFile() file: { buffer: Buffer; size: number; originalname: string },
    @Headers("Idempotency-Key") idempotencyKey: string,
    @GetCurrentUser() currentUser: CurrentUser,
  ) {
    return this.userImport.preview(file, currentUser.id, idempotencyKey);
  }

  /** Chuyển yêu cầu xác nhận phiên cho service giao dịch
   * Đầu vào là UUID phiên và Admin từ token; đầu ra là kết quả persisted, bao gồm trạng thái credential từng dòng
   * Service che phiên của Admin khác như 404 và rollback toàn lô nếu TTL, Unit hoặc uniqueness không còn hợp lệ
   */
  @Post("import/:importId/confirm")
  @HttpCode(HttpStatus.OK)
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Tạo các tài khoản đã xem trước trong một giao dịch" })
  confirmImport(@Param("importId", importSessionIdPipe) importId: string, @GetCurrentUser() currentUser: CurrentUser) {
    return this.userImport.confirm(importId, currentUser.id);
  }

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

  /** Đặt một delivery lỗi về trạng thái chờ để worker xử lý lại
   * Đầu vào gồm userId, channel đã allowlist và actor Admin; đầu ra chỉ xác nhận PENDING
   * Service cần payload còn mã hóa, session còn TTL, Email đã được xác nhận hoặc Web Push có subscription
   * Request không gọi mạng, không tạo lại password và không nhận channel ZNS
   */
  @Post(":id/credential-deliveries/retry")
  @HttpCode(HttpStatus.OK)
  @Roles("ADMIN")
  @ApiOperation({ summary: "[ADMIN] Thử lại kênh gửi thông tin đăng nhập đã thất bại" })
  @ApiBody({ type: RetryCredentialDeliveryDto })
  retryCredentialDelivery(@Param("id", credentialUserIdPipe) id: string, @Body() body: RetryCredentialDeliveryDto, @GetCurrentUser() user: CurrentUser) {
    return this.credentials!.retryChannel(id, body.channel, user.id);
  }

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
