import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EvaluationPeriodsController } from "./evaluation-periods.controller.js";
import { EvaluationPeriodsService } from "./evaluation-periods.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { PeriodWorkflowService } from "./period-workflow.service.js";

@Module({
  // NotificationsService chỉ ghi hộp thư nội bộ cùng transaction công bố và không xếp hàng kênh ngoài
  imports: [AuthModule, NotificationsModule],
  controllers: [EvaluationPeriodsController],
  providers: [EvaluationPeriodsService, PeriodWorkflowService],
  // Export use-case khóa/chuyển giai đoạn để các consumer VC09–VC12 không tự ghi phase
  exports: [EvaluationPeriodsService, PeriodWorkflowService],
})
export class EvaluationPeriodsModule {}
