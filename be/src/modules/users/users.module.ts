import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";
import { UserImportService } from "./user-import.service.js";

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService, UserImportService],
  exports: [UsersService, UserImportService],
})
export class UsersModule {}
