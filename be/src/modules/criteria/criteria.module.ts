import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CriteriaController } from "./criteria.controller.js";
import { CriteriaService } from "./criteria.service.js";
import { CriteriaItemController } from "./criteria-item.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [CriteriaController, CriteriaItemController],
  providers: [CriteriaService],
  exports: [CriteriaService],
})
export class CriteriaModule {}
