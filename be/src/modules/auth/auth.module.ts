import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { NotificationsModule } from "../notifications/notifications.module.js";

@Global()
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      // Dùng cùng issuer và audience khi ký và xác minh để token từ hệ thống khác không được chấp nhận
      // Giới hạn HS256 ở cả hai chiều, giá trị mặc định chỉ áp dụng khi chưa cấu hình
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_SECRET"),
        signOptions: { algorithm: "HS256", issuer: config.get<string>("JWT_ISSUER") ?? "seminar", audience: config.get<string>("JWT_AUDIENCE") ?? "seminar-client" },
        verifyOptions: { algorithms: ["HS256"], issuer: config.get<string>("JWT_ISSUER") ?? "seminar", audience: config.get<string>("JWT_AUDIENCE") ?? "seminar-client" },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
