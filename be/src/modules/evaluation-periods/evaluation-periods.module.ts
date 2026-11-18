import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EvaluationPeriodsController } from "./evaluation-periods.controller.js";
import { EvaluationPeriodsService } from "./evaluation-periods.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { PeriodWorkflowService } from "./period-workflow.service.js";
import { EvaluationStateModule } from "../evaluations/evaluation-state.module.js";

@Module({
  // Dùng chung reconcile hồ sơ với VC09 để chuyển phase không ghi lặp history/audit/outbox
  // NotificationsService tiếp tục ghi sự kiện kỳ trong transaction, không gọi provider trực tiếp
  imports: [AuthModule, NotificationsModule, EvaluationStateModule],
  controllers: [EvaluationPeriodsController],
  providers: [EvaluationPeriodsService, PeriodWorkflowService],
  // Export use-case khóa/chuyển giai đoạn để các consumer VC09–VC12 không tự ghi phase
  exports: [EvaluationPeriodsService, PeriodWorkflowService],
})
export class EvaluationPeriodsModule {}
