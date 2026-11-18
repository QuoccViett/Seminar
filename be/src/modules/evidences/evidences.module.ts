import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EvaluationStateModule } from "../evaluations/evaluation-state.module.js";
import { EvidencesController } from "./evidences.controller.js";
import { EvidencesService } from "./evidences.service.js";
import { StorageController } from "./storage.controller.js";
import { StorageProvider } from "./storage.provider.js";

/** Đăng ký storage và minh chứng theo cấu trúc Auth, dùng Prisma/audit chung
 * Capability controller riêng chỉ nhận bytes, nghiệp vụ cấp URL vẫn qua Auth guard đầy đủ
 */
@Module({ imports: [AuthModule, EvaluationStateModule], controllers: [EvidencesController, StorageController], providers: [EvidencesService, StorageProvider], exports: [EvidencesService] })
export class EvidencesModule {}
