import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { EvaluationPeriodsModule } from "../evaluation-periods/evaluation-periods.module.js";
import { EvaluationStateModule } from "./evaluation-state.module.js";
import { EvaluationsController } from "./evaluations.controller.js";
import { ReviewController } from "./review.controller.js";
import { ReviewService } from "./review.service.js";
import { EvaluationsService } from "./evaluations.service.js";
import { FeedbackController } from "./feedback.controller.js";
import { FeedbackService } from "./feedback.service.js";

/** Đăng ký hồ sơ, thẩm định, trao đổi và lịch sử theo cấu trúc Auth
 * Dùng chung trạng thái, audit và hộp thư để phản hồi không tự tạo cơ chế quyền hoặc provider riêng
 */
@Module({ imports: [AuthModule, EvaluationStateModule, NotificationsModule, EvaluationPeriodsModule], controllers: [EvaluationsController, ReviewController, FeedbackController], providers: [EvaluationsService, ReviewService, FeedbackService], exports: [EvaluationsService] })
export class EvaluationsModule {}
