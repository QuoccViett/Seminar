import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ExportsController } from "./exports.controller.js";
import { ExportsService } from "./exports.service.js";
import { ExcelReportGenerator } from "./generators/excel.generator.js";
import { PdfReportGenerator } from "./generators/pdf.generator.js";
import { WordReportGenerator } from "./generators/word.generator.js";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { ConfigModule } from "@nestjs/config";
import { ReportSnapshotService } from "./report-snapshot.service.js";
import { ReportStorageService } from "./report-storage.service.js";

/** Nối controller/service, nguồn snapshot và kho riêng với Auth/Prisma hiện có
 * Không đăng ký provider thông báo, xuất báo cáo không tự gửi tới người nhận ngoài
 */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    ConfigModule,
  ],
  controllers: [ExportsController],
  providers: [
    ExportsService,
    ExcelReportGenerator,
    PdfReportGenerator,
    WordReportGenerator,
    ReportSnapshotService,
    ReportStorageService,
  ],
  exports: [ExportsService],
})
export class ExportsModule {}
