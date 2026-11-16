import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** Tạo kết nối PostgreSQL từ cấu hình và yêu cầu mỗi phiên dùng múi giờ UTC
   * Dữ liệu lịch được xử lý nhất quán giữa các môi trường có múi giờ máy khác nhau
   */
  constructor(@Inject(ConfigService) configService: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: configService.getOrThrow<string>("DATABASE_URL"),
        options: "-c timezone=UTC",
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
