import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { Pool } from "pg";
import { MetricsService } from "../common/services/metrics.service.js";

@Injectable()
export class PrismaService extends PrismaClient<{ adapter: PrismaPg; log: [{ emit: "event"; level: "query" }] }> implements OnModuleInit, OnModuleDestroy {
  /** Tạo kết nối PostgreSQL từ cấu hình và yêu cầu mỗi phiên dùng múi giờ UTC
   * Dữ liệu lịch được xử lý nhất quán giữa các môi trường có múi giờ máy khác nhau
   */
  constructor(@Inject(ConfigService) configService: ConfigService, @Optional() @Inject(MetricsService) metrics?: MetricsService) {
    const pool = new Pool({ connectionString: configService.getOrThrow<string>("DATABASE_URL"), options: "-c timezone=UTC",
      max: configService.get<number>("DB_POOL_MAX") ?? 20, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
    super({
      // Pool thuộc service: cả $disconnect() trực tiếp và Nest shutdown đều phải đóng pool.
      adapter: new PrismaPg(pool, { disposeExternalPool: true }),
      log: [{ emit: "event", level: "query" }],
    });
    metrics?.registerPool(pool);
    this.$on("query", (event) => metrics?.observeQuery(event.duration));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
