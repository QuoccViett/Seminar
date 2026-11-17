import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { EmailNotificationProvider, WebPushNotificationProvider } from "./real-notification-providers.js";
import type { NotificationSendResult } from "./notification-provider.js";
import { AuditService } from "../../common/services/audit.service.js";

type CredentialPayload = { username: string; password: string; email: string | null; invitationUrl: string };
type Claim = { id: string; claim_token: string };
const EXPIRY_MS = 48 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** Không trả bản ghi thô khi chưa có lần cấp hoặc đã hết hiệu lực */
function missingDispatch() { return new NotFoundException({ code: "CREDENTIAL_DISPATCH_NOT_FOUND", message: "Không tìm thấy lượt cấp thông tin đăng nhập còn hiệu lực.", details: [] }); }

@Injectable()
export class CredentialDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CredentialDispatchService.name);
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(EmailNotificationProvider) private readonly email: EmailNotificationProvider,
    @Inject(WebPushNotificationProvider) private readonly push: WebPushNotificationProvider,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Khởi động quét việc đã commit; interval nhỏ chỉ giúp lấy việc, mọi quyền gửi được kiểm lại tại DB */
  onModuleInit(): void {
    this.timer = setInterval(() => { void this.dispatchPending().catch(() => this.logger.error("Không thể xử lý hàng đợi cấp thông tin đăng nhập; hệ thống sẽ thử lại")); }, 5000);
    this.timer.unref?.();
  }

  /** Dừng lượt quét khi Nest đóng; lease đã lưu cho phép tiến trình khác nhận lại sau hạn */
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** Lấy khóa mã hóa cố định từ cấu hình; không ghi giá trị này hoặc payload vào log */
  private key(): Buffer | null {
    const encoded = this.config.get<string>("CREDENTIALS_ENCRYPTION_KEY");
    return encoded ? Buffer.from(encoded, "base64") : null;
  }

  /** Mã hóa username/mật khẩu/email/link mời bằng AES-GCM với AAD gắn user và phiên bản
   * Không có khóa thì không tạo dispatch, mật khẩu chỉ còn trong phản hồi cấp một lần theo VC04
   */
  async enqueue(tx: Prisma.TransactionClient, input: { userId: string; version: number; username: string; password: string; email: string | null }): Promise<boolean> {
    const key = this.key();
    if (!key) return false;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_MS);
    const token = randomBytes(48).toString("base64url");
    const base = (this.config.get<string>("PUBLIC_APP_URL") ?? this.config.get<string>("WEB_ORIGINS")?.split(",")[0] ?? this.config.get<string>("CORS_ORIGINS")?.split(",")[0] ?? "").replace(/\/$/, "");
    const payload: CredentialPayload = { username: input.username, password: input.password, email: input.email, invitationUrl: `${base}/onboarding/web-push#token=${token}` };
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(`${input.userId}:${input.version}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]).toString("base64");
    const authTag = cipher.getAuthTag().toString("base64");
    const id = randomUUID();
    const channels = [
      ...(this.config.get<boolean>("EMAIL_ENABLED") === true ? ["EMAIL"] : []),
      ...(this.config.get<boolean>("WEB_PUSH_ENABLED") === true ? ["WEB_PUSH"] : []),
    ];
    await tx.credentialDispatch.create({ data: { id, userId: input.userId, credentialVersion: input.version, ciphertext, nonce: nonce.toString("base64"), authTag, keyId: createHash("sha256").update(key).digest("hex").slice(0, 16), expiresAt, createdAt: now, deliveries: { create: channels.map((channel) => ({ id: randomUUID(), channel, status: "PENDING", errorCode: channel === "WEB_PUSH" ? "NO_SUBSCRIPTION" : "EMAIL_UNCONFIRMED", createdAt: now, updatedAt: now })) } } });
    if (channels.includes("WEB_PUSH")) await tx.onboardingToken.create({ data: { id: randomUUID(), userId: input.userId, purpose: "WEB_PUSH", credentialVersion: input.version, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt, createdAt: now } });
    return true;
  }

  /** Hủy mọi dispatch cũ và xóa bộ ba giải mã trong cùng transaction đổi/reset/khóa user
   * Trạng thái từng kênh còn lại để Admin phân biệt việc đã gửi và việc bị hủy
   */
  async cancelForUser(tx: Prisma.TransactionClient, userId: string, now = new Date()): Promise<void> {
    await tx.credentialDispatch.updateMany({ where: { userId, canceledAt: null }, data: { canceledAt: now, ciphertext: null, nonce: null, authTag: null } });
    await tx.credentialDelivery.updateMany({ where: { dispatch: { userId }, status: "PENDING" }, data: { status: "SKIPPED", errorCode: "CREDENTIAL_CHANGED", claimToken: null, claimedAt: null, leaseUntil: null, nextAttemptAt: null, updatedAt: now } });
    await tx.onboardingToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  }

  /** Xác nhận email hiện tại do Admin đã kiểm tra ngoài hệ thống trước khi cho worker gửi bí mật
   * Chuỗi email trong request phải khớp hồ sơ và payload snapshot để sửa email không chuyển credential cũ
   */
  async confirmEmail(userId: string, email: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, credentialVersion: true, mustChangePassword: true } });
      if (!user) throw missingDispatch();
      if (!user.email || user.email !== email.trim().toLowerCase()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "Email xác nhận không khớp tài khoản hiện tại.", details: [{ field: "email", messages: ["Hãy kiểm tra đúng địa chỉ email trước khi xác nhận gửi."] }] });
      const dispatch = await tx.credentialDispatch.findUnique({ where: { userId_credentialVersion: { userId, credentialVersion: user.credentialVersion } }, include: { deliveries: true } });
      if (!dispatch || dispatch.canceledAt || dispatch.expiresAt <= new Date() || !dispatch.ciphertext || !user.mustChangePassword) throw missingDispatch();
      const payload = this.decrypt(dispatch);
      if (payload.email !== user.email || !dispatch.deliveries.some((item) => item.channel === "EMAIL")) throw missingDispatch();
      const now = new Date();
      await tx.credentialDispatch.update({ where: { id: dispatch.id }, data: { emailConfirmedAt: now } });
      await tx.credentialDelivery.updateMany({ where: { dispatchId: dispatch.id, channel: "EMAIL", status: "PENDING" }, data: { errorCode: null, nextAttemptAt: null, updatedAt: now } });
      // Audit chỉ ghi ID lượt cấp và kênh, không ghi email hoặc mật khẩu dù Admin vừa xác nhận
      await this.audit.record({ actorId, action: "CREDENTIAL_EMAIL_CONFIRMED", entity: "CredentialDispatch", entityId: dispatch.id, after: { channel: "EMAIL" } }, tx);
      return this.status(userId, tx);
    });
  }

  /** Chỉ trả trạng thái kênh cho Admin, không đưa ciphertext, token mời hoặc email vào API */
  async status(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { credentialVersion: true, credentialsSentAt: true } });
    if (!user) throw missingDispatch();
    const dispatch = await tx.credentialDispatch.findUnique({ where: { userId_credentialVersion: { userId, credentialVersion: user.credentialVersion } }, select: { id: true, expiresAt: true, deliveries: { select: { channel: true, status: true, errorCode: true, attemptCount: true, sentAt: true }, orderBy: { channel: "asc" } } } });
    const channels = dispatch?.deliveries ?? [];
    return { credentialsSentAt: user.credentialsSentAt, allRequiredChannelsSent: channels.length > 0 && channels.every((item) => item.status === "SENT"), channels, expiresAt: dispatch?.expiresAt ?? null, status: dispatch ? "QUEUED" : "NOT_CONFIGURED", zaloZnsAvailable: false };
  }

  /** Giải mã chỉ bên trong worker hoặc xác nhận Admin; AAD chặn đổi payload giữa user/version */
  private decrypt(dispatch: { userId: string; credentialVersion: number; ciphertext: string | null; nonce: string | null; authTag: string | null; keyId: string }): CredentialPayload {
    const key = this.key();
    if (!key || !dispatch.ciphertext || !dispatch.nonce || !dispatch.authTag || createHash("sha256").update(key).digest("hex").slice(0, 16) !== dispatch.keyId) throw new Error("Không thể giải mã thông tin cấp tài khoản do thiếu khóa phù hợp");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(dispatch.nonce, "base64"));
    decipher.setAAD(Buffer.from(`${dispatch.userId}:${dispatch.credentialVersion}`));
    decipher.setAuthTag(Buffer.from(dispatch.authTag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(dispatch.ciphertext, "base64")), decipher.final()]).toString("utf8")) as CredentialPayload;
  }

  /** Claim một việc có hạn bằng SKIP LOCKED để nhiều worker không lấy cùng delivery */
  async claimOne(): Promise<Claim | null> {
    const token = randomUUID();
    const rows = await this.prisma.$transaction((tx) => tx.$queryRaw<Claim[]>`
      UPDATE credential_deliveries AS d SET claimed_at = clock_timestamp(), lease_until = clock_timestamp() + interval '30 seconds', claim_token = ${token}::uuid, updated_at = clock_timestamp()
      WHERE d.id = (SELECT id FROM credential_deliveries WHERE status = 'PENDING'
        AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())
        AND (lease_until IS NULL OR lease_until <= clock_timestamp())
        ORDER BY next_attempt_at NULLS FIRST, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING d.id, d.claim_token
    `);
    return rows[0] ?? null;
  }

  /** Xử lý một claim dưới khóa dòng user để đổi/reset mật khẩu không vượt qua việc gửi đang diễn ra
   * Mọi nhánh kiểm version, hạn, xác nhận email và subscription ngay trước khi gọi provider
   */
  async processClaim(claim: Claim): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const initial = await tx.credentialDelivery.findUnique({ where: { id: claim.id }, select: { dispatch: { select: { userId: true } } } });
      if (!initial) return;
      await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${initial.dispatch.userId}::uuid FOR UPDATE`;
      const delivery = await tx.credentialDelivery.findUnique({ where: { id: claim.id }, include: { dispatch: { include: { user: { select: { credentialVersion: true, mustChangePassword: true, isActive: true, email: true } } } } } });
      if (!delivery || delivery.claimToken !== claim.claim_token || delivery.status !== "PENDING") return;
      const dispatch = delivery.dispatch;
      const now = new Date();
      if (dispatch.canceledAt || dispatch.expiresAt <= now || !dispatch.user.isActive || !dispatch.user.mustChangePassword || dispatch.user.credentialVersion !== dispatch.credentialVersion || !dispatch.ciphertext) {
        await this.finish(tx, claim, delivery.attemptCount, { kind: "skip", reasonCode: "CREDENTIAL_CHANGED", message: "Thông tin đăng nhập đã thay đổi." });
        await tx.credentialDispatch.update({ where: { id: dispatch.id }, data: { canceledAt: now, ciphertext: null, nonce: null, authTag: null } });
        return;
      }
      let payload: CredentialPayload;
      try { payload = this.decrypt(dispatch); }
      catch { await this.finish(tx, claim, delivery.attemptCount, { kind: "skip", reasonCode: "KEY_UNAVAILABLE", message: "Không thể giải mã thông tin cấp tài khoản." }); return; }
      if (delivery.channel === "EMAIL" && (!dispatch.emailConfirmedAt || !dispatch.user.email || payload.email !== dispatch.user.email)) {
        await this.defer(tx, claim, "EMAIL_UNCONFIRMED"); return;
      }
      if (delivery.channel === "WEB_PUSH" && !await this.push.resolveRecipient(dispatch.userId)) {
        await this.defer(tx, claim, "NO_SUBSCRIPTION"); return;
      }
      const body = `Tên đăng nhập: ${payload.username}\nMật khẩu ban đầu: ${payload.password}\nBạn phải đổi mật khẩu khi đăng nhập lần đầu.${delivery.channel === "EMAIL" ? `\nĐăng ký thiết bị nhận thông báo: ${payload.invitationUrl}` : ""}`;
      const provider = delivery.channel === "EMAIL" ? this.email : this.push;
      let result: NotificationSendResult;
      try { result = await provider.send({ userId: dispatch.userId, notificationId: dispatch.id, title: "Thông tin đăng nhập hệ thống đánh giá", body, refType: "CREDENTIAL", refId: null }); }
      catch { result = { kind: "retry", reasonCode: "PROVIDER_ERROR", message: "Không thể gửi thông tin đăng nhập, hệ thống sẽ thử lại." }; }
      // Mọi subscription vừa bị push service thu hồi đều quay lại trạng thái chờ thiết bị mới đến TTL
      if (delivery.channel === "WEB_PUSH" && result.kind === "skip" && result.reasonCode === "RECIPIENT_MISSING") { await this.defer(tx, claim, "NO_SUBSCRIPTION"); return; }
      await this.finish(tx, claim, delivery.attemptCount, result);
      if (result.kind === "sent") await tx.user.updateMany({ where: { id: dispatch.userId, credentialVersion: dispatch.credentialVersion, credentialsSentAt: null }, data: { credentialsSentAt: new Date() } });
      const unfinished = await tx.credentialDelivery.count({ where: { dispatchId: dispatch.id, status: "PENDING" } });
      if (unfinished === 0) await tx.credentialDispatch.update({ where: { id: dispatch.id }, data: { ciphertext: null, nonce: null, authTag: null } });
    }, { timeout: 20000 });
  }

  /** Hoãn việc thiếu điều kiện nhận tới lượt sau mà không tiêu hao số lần gọi provider
   * Khi thiết bị được gắn hoặc email được xác nhận, API đưa nextAttemptAt về null để worker lấy ngay
   */
  private async defer(tx: Prisma.TransactionClient, claim: Claim, code: string): Promise<void> {
    await tx.credentialDelivery.updateMany({ where: { id: claim.id, claimToken: claim.claim_token, status: "PENDING" }, data: { errorCode: code, nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000), claimedAt: null, leaseUntil: null, claimToken: null, updatedAt: new Date() } });
  }

  /** Kết thúc theo claimToken để worker cũ không ghi đè; lỗi tạm thử tối đa năm lần trong TTL */
  private async finish(tx: Prisma.TransactionClient, claim: Claim, previous: number, result: NotificationSendResult): Promise<void> {
    const attempts = previous + 1;
    const retry = result.kind === "retry" && attempts < MAX_ATTEMPTS;
    await tx.credentialDelivery.updateMany({ where: { id: claim.id, claimToken: claim.claim_token, status: "PENDING" }, data: { status: result.kind === "sent" ? "SENT" : result.kind === "skip" ? "SKIPPED" : retry ? "PENDING" : "FAILED", attemptCount: attempts, errorCode: result.kind === "sent" ? null : result.reasonCode, nextAttemptAt: retry ? new Date(Date.now() + Math.min(3600, 30 * 2 ** (attempts - 1)) * 1000) : null, claimedAt: null, leaseUntil: null, claimToken: null, messageId: result.kind === "sent" ? result.providerMessageId?.slice(0, 255) ?? null : null, sentAt: result.kind === "sent" ? new Date() : null, updatedAt: new Date() } });
  }

  /** Dọn payload quá hạn và lấy một lô nhỏ để giới hạn thời gian worker chiếm kết nối */
  async dispatchPending(limit = 10): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;
    try {
      const now = new Date();
      await this.prisma.credentialDispatch.updateMany({ where: { expiresAt: { lte: now }, ciphertext: { not: null } }, data: { canceledAt: now, ciphertext: null, nonce: null, authTag: null } });
      await this.prisma.credentialDelivery.updateMany({ where: { status: "PENDING", dispatch: { expiresAt: { lte: now } } }, data: { status: "SKIPPED", errorCode: "EXPIRED", claimToken: null, claimedAt: null, leaseUntil: null, nextAttemptAt: null, updatedAt: now } });
      let count = 0;
      while (count < limit) { const claim = await this.claimOne(); if (!claim) break; await this.processClaim(claim); count += 1; }
      return count;
    } finally { this.processing = false; }
  }
}
