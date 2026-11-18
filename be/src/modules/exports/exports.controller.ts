import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { GetCurrentUser } from "../../common/decorators/current-user.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { CreateReportExportDto } from "./dto/create-report-export.dto.js";
import { ReportExportQueryDto } from "./dto/report-export-query.dto.js";
import { ExportsService } from "./exports.service.js";
import { ReportDownloadQueryDto } from "./dto/report-download-query.dto.js";
import { ReportExportMetadataDto, ReportExportPageDto } from "./dto/report-export-metadata.dto.js";

/** Biên HTTP của báo cáo chỉ dành ADMIN, validation và guard áp trước mọi thao tác đọc hoặc tải */
@ApiTags("Báo cáo")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 400, description: "Dữ liệu hoặc phạm vi báo cáo không hợp lệ" })
@ApiResponse({ status: 401, description: "Cần đăng nhập bằng phiên hợp lệ" })
@ApiResponse({ status: 403, description: "Không có quyền hoặc liên kết tải không còn hợp lệ" })
@ApiResponse({ status: 404, description: "Không tìm thấy kỳ, hồ sơ hoặc tệp báo cáo" })
@ApiResponse({ status: 503, description: "Kho báo cáo chưa sẵn sàng" })
@Controller("api/v1/admin/reports/exports")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class ExportsController {
  /** Nhận service điều phối, mọi tuyến bên dưới đều dùng guard ADMIN và chặn phiên chưa đổi mật khẩu */
  constructor(
    @Inject(ExportsService)
    private readonly exportsService: ExportsService,
  ) {}

  @Post()
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Tạo báo cáo Excel, PDF hoặc Word" })
  @ApiBody({ type: CreateReportExportDto })
  @ApiResponse({ status: 201, description: "Thông tin báo cáo vừa tạo", type: ReportExportMetadataDto })
  /** Chuyển người đã xác thực cùng DTO vào service, chỉ trả thành công khi lưu tệp và audit đã hoàn tất */
  create(
    @GetCurrentUser() currentUser: CurrentUser,
    @Body() dto: CreateReportExportDto,
  ) {
    return this.exportsService.create(currentUser.id, dto);
  }

  @Get()
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Danh sách lịch sử xuất báo cáo" })
  @ApiOkResponse({ type: ReportExportPageDto })
  @ApiQuery({ name: "periodId", required: false, format: "uuid" })
  /** Đọc trang metadata và cấp URL ngắn hạn riêng cho quản trị viên hiện tại */
  findAll(@Query() query: ReportExportQueryDto, @GetCurrentUser() currentUser: CurrentUser) {
    return this.exportsService.findAll(query, currentUser.id);
  }

  @Get(":id/download")
  @ApiProduces("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  @ApiOperation({ summary: "Tải tệp báo cáo" })
  @ApiOkResponse({ description: "Tệp riêng tư XLSX, PDF hoặc DOCX", schema: { type: "string", format: "binary" } })
  /** Trả tệp riêng cho quản trị viên đã qua guard và ngăn bộ đệm lưu nội dung nhạy cảm
   * Mã hồ sơ được kiểm tra trước khi service đọc tệp, lỗi không tiết lộ đường dẫn lưu trữ
   */
  async download(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ReportDownloadQueryDto,
    @GetCurrentUser() currentUser: CurrentUser,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.exportsService.getDownload(id, currentUser.id, query.token);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", file.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="bao-cao.${file.fileName.split(".").pop()}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.setHeader("Content-Length", file.buffer.length);
    response.end(file.buffer);
  }

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Xem metadata của một lần xuất báo cáo" })
  @ApiOkResponse({ type: ReportExportMetadataDto })
  /** Đọc metadata mới để làm mới chữ ký khi URL của danh sách đã hết hạn */
  findOne(@Param("id", ParseUUIDPipe) id: string, @GetCurrentUser() currentUser: CurrentUser) {
    return this.exportsService.findOne(id, currentUser.id);
  }
}
