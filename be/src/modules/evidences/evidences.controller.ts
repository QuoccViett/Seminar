import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GetCurrentUser, type CurrentUser } from "../../common/decorators/current-user.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { EvidenceBatchDto, UploadBatchDto } from "./dto/evidence.dto.js";
import { EvidencesService } from "./evidences.service.js";

/** Nhận HTTP đã xác thực và DTO allowlist, service kiểm sở hữu, lịch và quota
 * Tất cả định danh route dùng UUID để không chuyển dữ liệu tùy ý xuống SQL
 */
@ApiTags("Evidence")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 400, description: "Dữ liệu gửi lên không hợp lệ" })
@ApiResponse({ status: 403, description: "Không có quyền hoặc hồ sơ đã khóa" })
@ApiResponse({ status: 404, description: "Không tìm thấy minh chứng trong phạm vi" })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "UNIT")
@Controller("api/v1/evaluations/:evaluationId/evidences")
export class EvidencesController {
  /** Inject tường minh giữ cấu trúc module mẫu và khả năng chạy ESM */
  constructor(@Inject(EvidencesService) private readonly service: EvidencesService) {}

  /** Xin URL từng file bằng identity từ guard, không nhận key hoặc round tùy ý */
  @Post("upload-urls")
  @HttpCode(200)
  @Roles("UNIT")
  @ApiBody({ type: UploadBatchDto })
  @ApiOperation({ summary: "[UNIT] Xin URL tải lên cho nhiều tệp minh chứng của hồ sơ" })
  uploads(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() dto: UploadBatchDto, @GetCurrentUser() user: CurrentUser) { return this.service.uploads(id, dto, user); }

  /** Xác nhận bytes hoặc link, HTTP 200 luôn cần kiểm cờ ok của từng phần tử */
  @Post()
  @HttpCode(200)
  @Roles("UNIT")
  @ApiBody({ type: EvidenceBatchDto })
  @ApiOperation({ summary: "[UNIT] Xác nhận các tệp hoặc liên kết minh chứng đã tải lên" })
  create(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Body() dto: EvidenceBatchDto, @GetCurrentUser() user: CurrentUser) { return this.service.create(id, dto, user); }

  /** Hủy phiên chờ của chính chủ, không biến thao tác dọn tệp thành sửa minh chứng */
  @Delete("uploads/:uploadId")
  @Roles("UNIT")
  @ApiOperation({ summary: "[UNIT] Hủy phiên tải minh chứng chưa được xác nhận" })
  cancel(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Param("uploadId", new ParseUUIDPipe({ version: "4" })) uploadId: string, @GetCurrentUser() user: CurrentUser) { return this.service.cancel(id, uploadId, user); }

  /** Đọc metadata và URL tải ngắn hạn theo quyền hiện tại */
  @Get(":evidenceId")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "[ADMIN, UNIT] Xem thông tin minh chứng và xin liên kết tải tệp theo quyền hồ sơ" })
  read(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Param("evidenceId", new ParseUUIDPipe({ version: "4" })) evidenceId: string, @GetCurrentUser() user: CurrentUser) { return this.service.read(id, evidenceId, user); }

  /** Chỉ cấp URL preview cho ảnh/PDF, Word nhận thông báo tải xuống bằng tiếng Việt */
  @Get(":evidenceId/preview")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "[ADMIN, UNIT] Xin liên kết xem trước ảnh hoặc PDF theo quyền hồ sơ" })
  preview(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Param("evidenceId", new ParseUUIDPipe({ version: "4" })) evidenceId: string, @GetCurrentUser() user: CurrentUser) { return this.service.read(id, evidenceId, user, true); }

  /** Xóa bằng quyền BE và tombstone sau commit, ADMIN không được thay nội dung UNIT */
  @Delete(":evidenceId")
  @Roles("UNIT")
  @ApiOperation({ summary: "[UNIT] Xóa minh chứng khi hồ sơ và lượt hiện tại còn cho phép chỉnh sửa" })
  remove(@Param("evaluationId", new ParseUUIDPipe({ version: "4" })) id: string, @Param("evidenceId", new ParseUUIDPipe({ version: "4" })) evidenceId: string, @GetCurrentUser() user: CurrentUser) { return this.service.remove(id, evidenceId, user); }
}
