import { ClockService } from "../../dist/common/services/clock.service.js";
import "reflect-metadata";
import process from "node:process";
import { URL } from "node:url";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../dist/prisma/prisma.service.js";
import { NotificationsService } from "../../dist/modules/notifications/notifications.service.js";
import { CredentialDispatchService } from "../../dist/modules/notifications/credential-dispatch.service.js";
import { SchedulerService } from "../../dist/modules/scheduler/scheduler.service.js";
import { EvaluationStateService } from "../../dist/modules/evaluations/evaluation-state.service.js";
import { AuditService } from "../../dist/common/services/audit.service.js";

// Tiến trình con chỉ kết nối database kiểm thử và dùng provider giả không thực hiện I/O mạng
// Mỗi lần khởi chạy tạo worker mới để kiểm lease tồn tại độc lập với bộ nhớ tiến trình cũ
if (!/^\/vc11_recovery_test(?:_[a-z0-9]+)?$/.test(new URL(process.env.VC11_TEST_DATABASE_URL).pathname)) throw new Error("Chỉ được dùng cơ sở dữ liệu kiểm thử VC11 riêng");
const config = new ConfigService({ DATABASE_URL: process.env.VC11_TEST_DATABASE_URL, CREDENTIALS_ENCRYPTION_KEY: process.env.VC11_TEST_KEY, EMAIL_ENABLED: true, WEB_PUSH_ENABLED: false, ZALO_ZNS_ENABLED: false });
const prisma = new PrismaService(config);
const fake = { channel: "EMAIL", resolveRecipient: async () => true, send: async () => ({ kind: "sent" }) };
// Dùng audit thật để tiến trình khôi phục giữ dấu vết worker cùng transaction
const notifications = new NotificationsService(prisma, config, [fake], new AuditService(prisma, new ClockService()));
const credentials = new CredentialDispatchService(prisma, config, fake, fake, {});
try {
  await prisma.$connect();
  if (process.env.VC11_ACTION === "claim") {
    // Nhận mỗi loại delivery một lần rồi đóng kết nối mà không hoàn tất để mô phỏng dừng đột ngột
    const result = { notification: await notifications.claimOne(), credential: await credentials.claimOne() };
    process.stdout.write(JSON.stringify(result));
  } else if (process.env.VC11_ACTION === "finish") {
    // Tiến trình mới hoàn tất claim hợp lệ bằng provider giả, không in payload credential
    await notifications.processClaim(JSON.parse(process.env.VC11_NOTIFICATION_CLAIM));
    await credentials.processClaim(JSON.parse(process.env.VC11_CREDENTIAL_CLAIM));
    process.stdout.write("Đã xử lý delivery kiểm thử");
  } else if (process.env.VC11_ACTION === "period") {
    // Khi tiến trình khởi động sau deadline, chạy lại kỳ đã lưu bằng use-case và giờ database
    const audit = new AuditService(prisma, new ClockService());
    const state = new EvaluationStateService(audit, notifications);
    const scheduler = new SchedulerService(prisma, audit, state, notifications);
    await scheduler.processPeriod(process.env.VC11_PERIOD_ID);
    await notifications.flushOutbox(100);
    process.stdout.write("Đã quét kỳ kiểm thử");
  } else throw new Error("Lệnh worker kiểm thử không hợp lệ");
} finally { await prisma.$disconnect(); }
