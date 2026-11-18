import { Module } from "@nestjs/common";
import { EvaluationStateModule } from "../evaluations/evaluation-state.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { SchedulerService } from "./scheduler.service.js";
import { SchedulerController } from "./scheduler.controller.js";
import { AuthModule } from "../auth/auth.module.js";

/** Đăng ký bộ quét nghiệp vụ cùng use-case trạng thái và outbox đã dùng ở API
 * Các provider được Nest dùng chung, không tạo worker gửi ngoài trong transaction kỳ
 */
@Module({ imports: [AuthModule, EvaluationStateModule, NotificationsModule], controllers: [SchedulerController], providers: [SchedulerService] })
export class SchedulerModule {}
