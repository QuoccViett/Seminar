import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { EvaluationStateService } from "./evaluation-state.service.js";

/** Cấp use-case reconcile độc lập để module kỳ và hồ sơ dùng chung mà không phụ thuộc vòng
 * Audit/Prisma dùng provider chung hiện có, thông báo chỉ ghi outbox trong transaction của caller
 */
@Module({ imports: [NotificationsModule], providers: [EvaluationStateService], exports: [EvaluationStateService] })
export class EvaluationStateModule {}
