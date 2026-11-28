import { Inject, Injectable, Logger, NestMiddleware, Optional } from "@nestjs/common";
import { RuntimeCache } from "../services/runtime-cache.service.js";
import { MetricsService } from "../services/metrics.service.js";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");
  constructor(@Optional() @Inject(RuntimeCache) private readonly cache?: RuntimeCache, @Optional() @Inject(MetricsService) private readonly metrics?: MetricsService) {}

  /** Gắn mã ngẫu nhiên và chỉ ghi phương thức, trạng thái cùng thời gian xử lý
   * Không ghi URL, header hoặc nội dung vì bí mật có thể nằm ở bất kỳ vị trí nào
   * Đầu vào là request và response Express, sau khi đăng ký sự kiện thì chuyển tiếp
   */
  use(request: Request & { requestId?: string }, response: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const startedAt = Date.now();
    request.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    this.logger.log(JSON.stringify({ event: "request", requestId, method: request.method }));
    response.on("finish", () => {
      this.metrics?.observeHttp(request.method, request.route?.path ?? "unmatched", response.statusCode, (Date.now() - startedAt) / 1000);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) this.cache?.invalidate();
      this.logger.log(JSON.stringify({
        event: "response", requestId, method: request.method,
        statusCode: response.statusCode, durationMs: Date.now() - startedAt,
      }));
    });
    next();
  }
}
