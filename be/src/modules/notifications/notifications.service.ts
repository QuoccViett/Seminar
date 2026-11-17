import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { NOTIFICATION_PROVIDERS, type NotificationProvider, type NotificationSendResult } from "./notification-provider.js";
import type { NotificationQueryDto } from "./dto/notification-query.dto.js";
import type { NotificationPreferencesDto } from "./dto/notification-preferences.dto.js";

type Channel = "WEB_PUSH" | "EMAIL" | "ZALO_ZNS";
const CHANNELS: Channel[] = ["WEB_PUSH", "EMAIL", "ZALO_ZNS"];
const MAX_ATTEMPTS = 5;

/** Chuẩn hóa lỗi nghiệp vụ đầu vào để controller không trả thông báo tiếng Anh từ thư viện */
function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({ code: "VALIDATION_ERROR", message: "Dữ liệu gửi lên không hợp lệ.", details: [{ field, messages: [message] }] });
}

/** Dữ liệu nội bộ phải được tạo từ nghiệp vụ đã xác thực, không nhận title/body trực tiếp từ client
 * dedupeKey là khóa ổn định theo sự kiện; thiếu khóa nghĩa là cố ý tạo thông báo mới
 */
export interface NotifyUserInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  dedupeKey?: string;
  refType?: string;
  refId?: string;
  channels?: Channel[];
}

type Claimed = { id: string; claim_token: string };

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Optional() @Inject(NOTIFICATION_PROVIDERS) private readonly providers: NotificationProvider[] = [],
  ) {}

  /** Khởi động quét outbox đã lưu để việc đang chờ vẫn được nhận sau khi tiến trình khởi động lại
   * Mỗi nhịp tự chặn chồng lấn trong một tiến trình; nhiều tiến trình được DB khóa riêng
   */
  onModuleInit(): void {
    this.timer = setInterval(() => { void this.dispatchPending().catch(() => this.logger.error("Không thể xử lý hàng đợi thông báo; hệ thống sẽ thử lại ở lượt sau")); }, 5000);
    this.timer.unref?.();
  }

  /** Dừng nhịp quét khi ứng dụng tắt; lease trong DB sẽ tự hết hạn nếu đang gửi dở */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Tạo hộp thư SYSTEM và các delivery trong cùng transaction của nghiệp vụ gọi
   * Khi có dedupeKey, INSERT ON CONFLICT giữ bản cũ nên retry hoặc hai transaction đồng thời không gửi lặp
   * ZNS chỉ xếp hàng khi hệ thống bật và cá nhân cho phép; Email/Push theo mặc định bật nếu chưa lưu preference
   */
  async notifyUser(tx: Prisma.TransactionClient, input: NotifyUserInput) {
    if (!input.userId || !input.type.trim() || !input.title.trim() || !input.body.trim()) throw invalid("notification", "Thông báo phải có người nhận, loại, tiêu đề và nội dung.");
    if (input.type.length > 100 || input.title.length > 255 || input.body.length > 4000 || (input.dedupeKey?.length ?? 0) > 255) throw invalid("notification", "Thông báo hoặc khóa chống trùng vượt quá độ dài cho phép.");
    if (input.dedupeKey !== undefined && !input.dedupeKey.trim()) throw invalid("dedupeKey", "Khóa chống trùng không được để trống.");
    const requested = [...new Set(input.channels ?? CHANNELS)].filter((channel) => CHANNELS.includes(channel));
    const preferences = await tx.notificationPreference.findMany({ where: { userId: input.userId, channel: { in: requested } } });
    const enabled = new Map(preferences.map((item) => [item.channel, item.enabled]));
    const channels = requested.filter((channel) => (channel !== "ZALO_ZNS" || this.znsEnabled) && enabled.get(channel) !== false);
    const now = new Date();
    const create = {
      id: randomUUID(), userId: input.userId, channel: "SYSTEM", type: input.type, title: input.title,
      body: input.body, refType: input.refType ?? null, refId: input.refId ?? null,
      dedupeKey: input.dedupeKey ?? null, createdAt: now,
      deliveries: { create: channels.map((channel) => ({ id: randomUUID(), channel, status: "PENDING", createdAt: now, updatedAt: now })) },
    };
    if (!input.dedupeKey) return tx.notification.create({ data: create, include: { deliveries: true } });
    // INSERT ON CONFLICT giải quyết đồng thời hai transaction cùng khóa mà không làm transaction thua cuộc bị lỗi unique
    // Chỉ transaction tạo bản ghi mới thêm delivery; lần gọi lại đọc bản cũ nên không đổi nội dung hoặc xếp hàng lần nữa
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO notifications (id, user_id, channel, type, title, body, ref_type, ref_id, is_read, dedupe_key, created_at)
      VALUES (${create.id}::uuid, ${input.userId}::uuid, 'SYSTEM', ${input.type}, ${input.title}, ${input.body}, ${input.refType ?? null}, ${input.refId ?? null}::uuid, false, ${input.dedupeKey}, ${now})
      ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id
    `;
    if (inserted.length) {
      await tx.notificationDelivery.createMany({ data: channels.map((channel) => ({ id: randomUUID(), notificationId: create.id, channel, status: "PENDING", createdAt: now, updatedAt: now })) });
    }
    return tx.notification.findUniqueOrThrow({ where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } }, include: { deliveries: true } });
  }

  /** Liệt kê đúng hộp thư của user hiện tại, chọn trường công khai và giữ thứ tự ổn định giữa các trang */
  async list(userId: string, query: NotificationQueryDto) {
    const where = { userId, channel: "SYSTEM", ...(query.isRead === undefined ? {} : { isRead: query.isRead === "true" }) };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({ where, select: { id: true, type: true, title: true, body: true, refType: true, refId: true, isRead: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  /** Đếm thông báo chưa đọc theo người dùng đã xác thực, không dùng userId từ URL */
  async unreadCount(userId: string) {
    return { count: await this.prisma.notification.count({ where: { userId, channel: "SYSTEM", isRead: false } }) };
  }

  /** Đọc trạng thái delivery của thông báo thuộc chính user hiện tại
   * Chỉ trả mã lỗi chuẩn và thời điểm gửi, không trả endpoint, địa chỉ nhận hoặc payload nhà cung cấp
   */
  async deliveryStatus(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id: notificationId, userId, channel: "SYSTEM" }, select: { id: true, deliveries: { select: { channel: true, status: true, reasonCode: true, lastError: true, attemptCount: true, sentAt: true }, orderBy: { channel: "asc" } } } });
    if (!notification) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy thông báo được yêu cầu.", details: [] });
    return { notificationId: notification.id, channels: notification.deliveries };
  }

  /** Đánh dấu thông báo thuộc chính user; 404 cho ID lạ và ID của người khác để tránh lộ sự tồn tại */
  async markRead(userId: string, notificationId: string) {
    const result = await this.prisma.notification.updateMany({ where: { id: notificationId, userId, channel: "SYSTEM" }, data: { isRead: true } });
    if (!result.count) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy thông báo được yêu cầu." });
    return { isRead: true };
  }

  /** Chỉ cập nhật bản ghi chưa đọc để số lượng trả về phản ánh đúng số trạng thái đã đổi */
  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({ where: { userId, channel: "SYSTEM", isRead: false }, data: { isRead: true } });
    return { updated: result.count };
  }

  /** Hợp nhất giá trị mặc định với preference đã lưu; ZNS không thể hiện bật khi cờ hệ thống tắt */
  async getPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId, channel: { in: CHANNELS } } });
    const values = new Map(rows.map((row) => [row.channel, row.enabled]));
    return { SYSTEM: true, WEB_PUSH: values.get("WEB_PUSH") ?? true, EMAIL: values.get("EMAIL") ?? true, ZALO_ZNS: this.znsEnabled && (values.get("ZALO_ZNS") ?? true), zaloZnsAvailable: this.znsEnabled };
  }

  /** Ghi từng trường có mặt bằng upsert, không cho yêu cầu bật ZNS khi doanh nghiệp chưa kích hoạt
   * Ghi transaction để không có cập nhật một nửa khi nhiều kênh được sửa cùng lúc
   */
  async setPreferences(userId: string, body: NotificationPreferencesDto) {
    if (body.ZALO_ZNS === true && !this.znsEnabled) throw invalid("ZALO_ZNS", "Kênh Zalo ZNS chưa được kích hoạt.");
    const entries = CHANNELS.filter((channel) => body[channel] !== undefined).map((channel) => [channel, body[channel]!] as const);
    await this.prisma.$transaction(async (tx) => {
      for (const [channel, enabled] of entries) await tx.notificationPreference.upsert({ where: { userId_channel: { userId, channel } }, create: { userId, channel, enabled, updatedAt: new Date() }, update: { enabled, updatedAt: new Date() } });
    });
    return this.getPreferences(userId);
  }

  /** Tạo thông báo kiểm tra cho người đăng nhập; chọn một kênh để không vô ý xếp hàng ở kênh khác
   * SYSTEM chỉ kiểm hộp thư, còn các kênh ngoài được worker nhận sau commit
   */
  async test(userId: string, channel: "SYSTEM" | Channel) {
    const preferences = await this.getPreferences(userId);
    if (channel !== "SYSTEM" && !preferences[channel]) throw invalid("channel", "Kênh thông báo này chưa được bật.");
    const notification = await this.prisma.$transaction((tx) => this.notifyUser(tx, { userId, type: "TEST", title: "Thông báo kiểm tra", body: "Đây là thông báo kiểm tra từ hệ thống.", channels: channel === "SYSTEM" ? [] : [channel] }));
    return { notificationId: notification.id, queuedChannels: notification.deliveries.map((item) => item.channel) };
  }

  /** Nhận một việc bằng khóa hàng PostgreSQL để hai worker không cùng lấy một delivery
   * Lease hết hạn được nhận lại khi worker cũ dừng; claimToken mới vô hiệu hóa kết quả đến muộn của worker cũ
   */
  async claimOne(): Promise<Claimed | null> {
    const token = randomUUID();
    const rows = await this.prisma.$transaction((tx) => tx.$queryRaw<Claimed[]>`
      UPDATE notification_deliveries AS d SET
        claimed_at = clock_timestamp(), lease_until = clock_timestamp() + interval '30 seconds',
        claim_token = ${token}::uuid, updated_at = clock_timestamp()
      WHERE d.id = (
        SELECT id FROM notification_deliveries
        WHERE status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())
          AND (lease_until IS NULL OR lease_until <= clock_timestamp())
        ORDER BY next_attempt_at NULLS FIRST, created_at, id
        FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING d.id, d.claim_token
    `);
    return rows[0] ?? null;
  }

  /** Gửi một delivery đã claim, chỉ dùng provider được đăng ký cho kênh tương ứng
   * Ngoại lệ provider được thay bằng thông báo tiếng Việt cố định để không lộ lỗi ngoài vào DB hoặc API
   */
  async processClaim(claim: Claimed): Promise<void> {
    const delivery = await this.prisma.notificationDelivery.findUnique({ where: { id: claim.id }, include: { notification: true } });
    if (!delivery || delivery.claimToken !== claim.claim_token || delivery.status !== "PENDING") return;
    const provider = this.providers.find((item) => item.channel === delivery.channel);
    let result: NotificationSendResult;
    if (!provider || (delivery.channel === "ZALO_ZNS" && !this.znsEnabled)) {
      result = { kind: "skip", reasonCode: "PROVIDER_NOT_READY", message: "Kênh gửi chưa được cấu hình." };
    } else {
      try {
        const hasRecipient = await provider.resolveRecipient(delivery.notification.userId);
        result = hasRecipient
          ? await provider.send({ userId: delivery.notification.userId, notificationId: delivery.notificationId, title: delivery.notification.title, body: delivery.notification.body, refType: delivery.notification.refType, refId: delivery.notification.refId })
          : { kind: "skip", reasonCode: "RECIPIENT_MISSING", message: "Người nhận chưa có địa chỉ hoặc thiết bị phù hợp." };
      } catch {
        result = { kind: "retry", reasonCode: "PROVIDER_ERROR", message: "Không thể gửi thông báo qua kênh này, hệ thống sẽ thử lại." };
      }
    }
    await this.finishClaim(claim, delivery.attemptCount, result);
  }

  /** Hoàn tất có điều kiện theo token để worker cũ không ghi đè kết quả sau khi lease bị nhận lại
   * Lỗi tạm thử tối đa năm lần với backoff lũy thừa; lỗi vĩnh viễn được đánh dấu SKIPPED
   */
  async finishClaim(claim: Claimed, previousAttempts: number, result: NotificationSendResult): Promise<boolean> {
    const attempts = previousAttempts + 1;
    const retry = result.kind === "retry" && attempts < MAX_ATTEMPTS;
    const status = result.kind === "sent" ? "SENT" : result.kind === "skip" ? "SKIPPED" : retry ? "PENDING" : "FAILED";
    // Chỉ lưu câu cố định theo mã đã cho phép để provider không thể đẩy raw SQL, địa chỉ hoặc token vào DB
    const safeMessages: Record<string, string> = {
      PROVIDER_NOT_READY: "Kênh gửi chưa được cấu hình.",
      RECIPIENT_MISSING: "Người nhận chưa có địa chỉ hoặc thiết bị phù hợp.",
      PROVIDER_ERROR: "Không thể gửi thông báo qua kênh này.",
      RATE_LIMIT: "Kênh gửi đang giới hạn lượt gửi, hệ thống sẽ thử lại.",
      TEMPORARY_FAILURE: "Kênh gửi tạm thời gián đoạn, hệ thống sẽ thử lại.",
      PERMANENT_FAILURE: "Không thể gửi thông báo qua kênh này.",
    };
    const reasonCode = result.kind === "sent" ? null : result.reasonCode in safeMessages ? result.reasonCode : "PROVIDER_ERROR";
    const message = reasonCode ? safeMessages[reasonCode] : null;
    const nextAttemptAt = retry ? new Date(Date.now() + Math.min(60 * 60, 30 * 2 ** (attempts - 1)) * 1000) : null;
    const updated = await this.prisma.notificationDelivery.updateMany({ where: { id: claim.id, claimToken: claim.claim_token, status: "PENDING" }, data: { status, attemptCount: attempts, nextAttemptAt, claimedAt: null, leaseUntil: null, claimToken: null, reasonCode, lastError: message, providerMessageId: result.kind === "sent" ? result.providerMessageId?.slice(0, 255) ?? null : null, sentAt: result.kind === "sent" ? new Date() : null, updatedAt: new Date() } });
    return updated.count === 1;
  }

  /** Rút tối đa một lô nhỏ mỗi nhịp để worker không giữ việc quá lâu trong RAM
   * processing chỉ chống lặp trong tiến trình; đồng bộ đa tiến trình do SKIP LOCKED và claimToken đảm nhận
   */
  async dispatchPending(limit = 20): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;
    let count = 0;
    try {
      while (count < limit) {
        const claim = await this.claimOne();
        if (!claim) break;
        await this.processClaim(claim);
        count += 1;
      }
      return count;
    } finally { this.processing = false; }
  }

  /** Đọc cờ ZNS mỗi lần để API và worker cùng dùng chính sách mặc định tắt */
  private get znsEnabled(): boolean { return this.config.get<boolean>("ZALO_ZNS_ENABLED") === true; }
}
