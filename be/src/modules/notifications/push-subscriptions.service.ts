import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { PushSubscriptionDto } from "./dto/push-subscription.dto.js";

/** Chỉ các host push công khai đã biết được phép nhận request từ backend
 * Danh sách có thể mở rộng bằng cấu hình sau khi đánh giá nhà cung cấp mới
 */
const DEFAULT_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-pn1p.notify.windows.com"];

/** Tạo lỗi ổn định khi subscription không hợp lệ hoặc endpoint trỏ tới tài nguyên không được phép */
function invalidPush(message: string) {
  return new BadRequestException({ code: "VALIDATION_ERROR", message: "Dữ liệu đăng ký thông báo đẩy không hợp lệ.", details: [{ field: "endpoint", messages: [message] }] });
}

@Injectable()
export class PushSubscriptionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(ConfigService) private readonly config: ConfigService) {}

  /** Trả public key để FE dùng đúng cấu hình server, khi tắt không tiết lộ khóa không còn hiệu lực */
  publicKey() {
    const enabled = this.config.get<boolean>("WEB_PUSH_ENABLED") === true;
    return { enabled, publicKey: enabled ? this.config.get<string>("WEB_PUSH_VAPID_PUBLIC_KEY") : null };
  }

  /** Kiểm URL HTTPS và host cho phép trước khi lưu endpoint sẽ được worker gọi mạng sau này */
  private checkEndpoint(endpoint: string): void {
    let parsed: URL;
    try { parsed = new URL(endpoint); } catch { throw invalidPush("Endpoint thông báo đẩy phải là URL HTTPS hợp lệ."); }
    const configured = this.config.get<string>("WEB_PUSH_ALLOWED_HOSTS")?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) ?? DEFAULT_HOSTS;
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !configured.includes(parsed.hostname.toLowerCase())) throw invalidPush("Nhà cung cấp thông báo đẩy chưa được cho phép.");
  }

  /** Gắn một endpoint cho đúng user, không chuyển quyền endpoint đã thuộc người khác
   * Cùng endpoint của mình được cập nhật khóa và thời hạn vì trình duyệt có thể làm mới subscription
   */
  async register(userId: string, input: PushSubscriptionDto, tx: Prisma.TransactionClient = this.prisma) {
    if (!this.publicKey().enabled) throw invalidPush("Thông báo đẩy chưa được kích hoạt.");
    this.checkEndpoint(input.endpoint);
    const existing = await tx.webPushSubscription.findUnique({ where: { endpoint: input.endpoint }, select: { id: true, userId: true } });
    if (existing && existing.userId !== userId) throw new ConflictException({ code: "SUBSCRIPTION_OWNED", message: "Thiết bị này đã được đăng ký cho tài khoản khác.", details: [] });
    const now = new Date();
    try {
      if (existing) await tx.webPushSubscription.update({ where: { id: existing.id }, data: { p256dh: input.keys.p256dh, auth: input.keys.auth, expirationTime: input.expirationTime == null ? null : BigInt(input.expirationTime), revokedAt: null, updatedAt: now } });
      else await tx.webPushSubscription.create({ data: { id: randomUUID(), userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, expirationTime: input.expirationTime == null ? null : BigInt(input.expirationTime), createdAt: now, updatedAt: now } });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new ConflictException({ code: "SUBSCRIPTION_OWNED", message: "Thiết bị này đã được đăng ký cho tài khoản khác.", details: [] });
      throw error;
    }
    await tx.credentialDelivery.updateMany({ where: { channel: "WEB_PUSH", status: "PENDING", errorCode: "NO_SUBSCRIPTION", dispatch: { userId, canceledAt: null, expiresAt: { gt: now } } }, data: { errorCode: null, nextAttemptAt: null, updatedAt: now } });
    return { registered: true };
  }

  /** Thu hồi duy nhất endpoint của user từ access token, không trả thông tin thiết bị của người khác */
  async revoke(userId: string, endpoint: string) {
    await this.prisma.webPushSubscription.updateMany({ where: { userId, endpoint, revokedAt: null }, data: { revokedAt: new Date(), updatedAt: new Date() } });
    return { revoked: true };
  }

  /** Xác minh token mời bằng hash và phiên bản hiện tại, không cấp JWT hoặc quyền nghiệp vụ */
  async verify(token: string) {
    if (!this.publicKey().enabled) throw invalidPush("Thông báo đẩy chưa được kích hoạt.");
    const hash = createHash("sha256").update(token).digest("hex");
    const invitation = await this.prisma.onboardingToken.findUnique({ where: { tokenHash: hash }, include: { user: { select: { isActive: true, credentialVersion: true, mustChangePassword: true } } } });
    if (!invitation || invitation.purpose !== "WEB_PUSH" || invitation.usedAt || invitation.expiresAt <= new Date() || !invitation.user.isActive || !invitation.user.mustChangePassword || invitation.user.credentialVersion !== invitation.credentialVersion) throw new UnauthorizedException({ code: "INVALID_ONBOARDING_TOKEN", message: "Liên kết mời không hợp lệ hoặc đã hết hạn.", details: [] });
    return { valid: true, publicKey: this.publicKey().publicKey };
  }

  /** Dùng token đúng một lần trong transaction; update có điều kiện ngăn hai tab cùng gắn thiết bị */
  async registerWithInvitation(token: string, input: PushSubscriptionDto) {
    const hash = createHash("sha256").update(token).digest("hex");
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.onboardingToken.findUnique({ where: { tokenHash: hash }, include: { user: { select: { isActive: true, credentialVersion: true, mustChangePassword: true } } } });
      const now = new Date();
      if (!invitation || invitation.purpose !== "WEB_PUSH" || invitation.usedAt || invitation.expiresAt <= now || !invitation.user.isActive || !invitation.user.mustChangePassword || invitation.user.credentialVersion !== invitation.credentialVersion) throw new UnauthorizedException({ code: "INVALID_ONBOARDING_TOKEN", message: "Liên kết mời không hợp lệ hoặc đã hết hạn.", details: [] });
      const used = await tx.onboardingToken.updateMany({ where: { id: invitation.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (!used.count) throw new UnauthorizedException({ code: "INVALID_ONBOARDING_TOKEN", message: "Liên kết mời đã được sử dụng.", details: [] });
      return this.register(invitation.userId, input, tx);
    });
  }
}
