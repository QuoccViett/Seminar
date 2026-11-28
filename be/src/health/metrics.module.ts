import { Global, Module } from "@nestjs/common";
import { MetricsService } from "../common/services/metrics.service.js";
import { MetricsController } from "./metrics.controller.js";

@Global()
@Module({ providers: [MetricsService], controllers: [MetricsController], exports: [MetricsService] })
export class MetricsModule {}
