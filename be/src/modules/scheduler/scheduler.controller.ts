import { Controller, ForbiddenException, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { SchedulerService } from "./scheduler.service.js";

/** Cung cấp lệnh quét demo cho Admin đã xác thực và đã đổi mật khẩu ban đầu
 * Cờ cấu hình mặc định tắt, controller không nhận thời gian hay người nhận từ client
 */
@ApiTags("Scheduler")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
@Controller("api/v1/admin/scheduler")
export class SchedulerController {
  constructor(@Inject(SchedulerService) private readonly scheduler: SchedulerService, @Inject(ConfigService) private readonly config: ConfigService) {}

  /** Chạy một lượt quét bằng giờ DB, trả số kỳ đã xử lý và số lỗi không lộ lỗi nội bộ
   * Khi đang quét trả trạng thái bận, worker gửi ngoài tiếp tục chạy độc lập sau commit
   */
  @Post("run")
  @HttpCode(200)
  @ApiOperation({ summary: "[ADMIN] Chạy thủ công một lượt quét lịch trong môi trường demo đã bật công cụ" })
  async run() {
    if (this.config.get<boolean>("ENABLE_DEMO_TOOLS") !== true || this.config.get<string>("NODE_ENV") === "production") {
      throw new ForbiddenException({ code: "DEMO_TOOLS_DISABLED", message: "Công cụ chạy lịch thủ công chưa được bật" });
    }
    const result = await this.scheduler.run();
    return { ...result, message: result.busy ? "Một lượt quét khác đang chạy" : result.failed ? "Đã quét lịch, một số công việc sẽ được thử lại" : "Đã hoàn tất lượt quét lịch" };
  }
}
