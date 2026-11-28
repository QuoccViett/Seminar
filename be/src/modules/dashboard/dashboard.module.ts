import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";
import { DashboardCacheInterceptor } from "./dashboard-cache.interceptor.js";

@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardCacheInterceptor],
})
export class DashboardModule {}
