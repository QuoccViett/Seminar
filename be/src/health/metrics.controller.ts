import { Controller, Get, Header, Inject, NotFoundException, Req, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { MetricsService } from "../common/services/metrics.service.js";

@Controller("metrics")
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService, @Inject(ConfigService) private readonly config: ConfigService) {}
  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async get(@Req() request: { headers: { authorization?: string } }): Promise<string> {
    if (!this.metrics.enabled) throw new NotFoundException();
    const supplied = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${this.config.getOrThrow<string>("METRICS_TOKEN")}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new UnauthorizedException();
    return this.metrics.registry.metrics();
  }
}
