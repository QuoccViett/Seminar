import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EvaluationStateModule } from "./evaluation-state.module.js";
import { EvaluationsController } from "./evaluations.controller.js";
import { EvaluationsService } from "./evaluations.service.js";

/** Đăng ký lát hồ sơ theo cấu trúc Auth, dùng use-case trạng thái chung cho consumer sau
 * Không tạo storage hoặc provider mới vì upload và lịch job thuộc VC10/VC11
 */
@Module({ imports: [AuthModule, EvaluationStateModule], controllers: [EvaluationsController], providers: [EvaluationsService], exports: [EvaluationsService] })
export class EvaluationsModule {}
