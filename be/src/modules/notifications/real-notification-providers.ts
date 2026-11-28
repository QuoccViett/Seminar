import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { NotificationProvider, NotificationSendRequest, NotificationSendResult } from "./notification-provider.js";
import webpush from "web-push";
import nodemailer from "nodemailer";
import { createHmac, randomUUID } from "node:crypto";

/** Gửi email qua SMTP hoặc Apps Script và chỉ tra địa chỉ từ hồ sơ user phía máy chủ
 * Kênh chỉ hoạt động khi EMAIL_ENABLED bật; nội dung được escape khi tạo HTML để tránh chèn markup
 */
@Injectable()
export class EmailNotificationProvider implements NotificationProvider {
  readonly channel = "EMAIL" as const;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(ConfigService) private readonly config: ConfigService) {}
  /** Kiểm tra có địa chỉ nhận hợp lệ mà không ghi hoặc trả địa chỉ vào log */
  async resolveRecipient(userId: string): Promise<boolean> {
    if (this.config.get<boolean>("EMAIL_ENABLED") !== true) return false;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, isActive: true } });
    return !!user?.isActive && !!user.email;
  }
  /** Gửi một thông báo đã được worker nhận; lỗi thư viện được chuyển thành kết quả chuẩn hóa */
  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    if (this.config.get<boolean>("EMAIL_ENABLED") !== true) return { kind: "skip", reasonCode: "PROVIDER_NOT_READY", message: "Kênh gửi chưa được cấu hình." };
    try {
      const user = await this.prisma.user.findUnique({ where: { id: request.userId }, select: { email: true, isActive: true, credentialVersion: true, mustChangePassword: true } });
      if (!user?.isActive || !user.email) return { kind: "skip", reasonCode: "RECIPIENT_MISSING", message: "Người nhận chưa có địa chỉ hoặc thiết bị phù hợp." };
      if (request.credentialVersion !== undefined && (user.credentialVersion !== request.credentialVersion || !user.mustChangePassword || user.email !== request.recipientEmail)) return { kind: "skip", reasonCode: "CREDENTIAL_CHANGED", message: "Thông tin đăng nhập đã thay đổi." };
      if (request.expiresAt && Date.now() >= request.expiresAt.getTime()) return { kind: "skip", reasonCode: "EXPIRED", message: "Thông báo đã hết thời hạn gửi." };
      const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
      const sender = this.config.get<string>("MAIL_FROM") ?? this.config.getOrThrow<string>("SMTP_FROM");
      const message = { from: sender, to: user.email, subject: request.title, text: request.body, html: `<h1>${escape(request.title)}</h1><p>${escape(request.body).replace(/\n/g, "<br>")}</p>` };
      if (this.config.get<string>("EMAIL_PROVIDER") === "apps_script") return await this.sendAppsScript(message, request.notificationId, request.expiresAt);
      if (this.config.get<string>("EMAIL_PROVIDER") === "resend") return await this.sendResend(message, request.notificationId);
      const host = this.config.getOrThrow<string>("SMTP_HOST");
      const port = this.config.get<number>("SMTP_PORT") ?? 587;
      const local = ["localhost", "127.0.0.1", "::1"].includes(host) && this.config.get<boolean>("SMTP_ALLOW_INSECURE_LOCAL") === true;
      const transport = nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465 && !local, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000, ...(this.config.get<boolean>("SMTP_AUTH_REQUIRED") === false ? {} : { auth: { user: this.config.getOrThrow("SMTP_USER"), pass: this.config.getOrThrow("SMTP_PASSWORD") } }) });
      const result = await transport.sendMail(message);
      return { kind: "sent", providerMessageId: result.messageId };
    } catch (error) {
      // SMTP 5xx là lỗi vĩnh viễn của địa chỉ/cấu hình, 4xx và timeout có thể thử lại
      const responseCode = typeof error === "object" && error !== null && "responseCode" in error ? Number(error.responseCode) : 0;
      // SMTP 452 thường báo tài nguyên hoặc hạn mức tạm hết, không lưu phản hồi thô của server
      if (responseCode === 452) return { kind: "retry", reasonCode: "RATE_LIMIT", message: "Kênh gửi đang giới hạn lượt gửi, hệ thống sẽ thử lại." };
      return responseCode >= 500 ? { kind: "skip", reasonCode: "PERMANENT_FAILURE", message: "Không thể gửi thông báo qua kênh này." } : { kind: "retry", reasonCode: "TEMPORARY_FAILURE", message: "Kênh gửi tạm thời gián đoạn, hệ thống sẽ thử lại." };
    }
  }

  /** HTTPS API, có idempotency key ổn định cho retry và timeout hữu hạn. */
  private async sendResend(message: { from: string; to: string; subject: string; text: string; html: string }, id: string): Promise<NotificationSendResult> {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${this.config.getOrThrow<string>("RESEND_API_KEY")}`, "Content-Type": "application/json", "User-Agent": "seminar/1.0", "Idempotency-Key": `email-${id}` },
      body: JSON.stringify(message) });
    if (response.status === 429) return { kind: "retry", reasonCode: "RATE_LIMIT", message: "Kênh gửi đang giới hạn lượt gửi, hệ thống sẽ thử lại." };
    if (response.status === 401 || response.status === 403) return { kind: "retry", reasonCode: "PROVIDER_AUTH_FAILED", message: "Dịch vụ email chưa cấp quyền cho máy chủ." };
    if (response.status >= 500 || response.status === 408 || response.status === 409) return { kind: "retry", reasonCode: "TEMPORARY_FAILURE", message: "Dịch vụ email tạm thời gián đoạn." };
    if (!response.ok) return { kind: "skip", reasonCode: "PERMANENT_FAILURE", message: "Dịch vụ email từ chối yêu cầu." };
    const body = await response.json() as { id?: unknown };
    if (typeof body.id !== "string") return { kind: "retry", reasonCode: "TEMPORARY_FAILURE", message: "Dịch vụ email chưa trả xác nhận hợp lệ." };
    return { kind: "sent", providerMessageId: body.id };
  }

  /** Ký payload; chỉ theo redirect ContentService của Google bằng GET, không chuyển tiếp dữ liệu thư. */
  private async sendAppsScript(message: { to: string; subject: string; text: string; html: string }, notificationId: string, expiresAt?: Date | null): Promise<NotificationSendResult> {
    if (expiresAt && Date.now() >= expiresAt.getTime()) return { kind: "skip", reasonCode: "EXPIRED", message: "Thông báo đã hết thời hạn gửi." };
    const payload = Buffer.from(JSON.stringify({ id: notificationId, to: message.to, subject: message.subject, text: message.text, html: message.html, expiresAt: expiresAt?.getTime() ?? null })).toString("base64url");
    const timestamp = Date.now().toString();
    const nonce = randomUUID();
    const signature = createHmac("sha256", this.config.getOrThrow<string>("APPS_SCRIPT_SECRET")).update(`${timestamp}.${nonce}.${payload}`).digest("hex");
    const timeout = AbortSignal.timeout(12000);
    let response = await fetch(this.config.getOrThrow<string>("APPS_SCRIPT_URL"), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp, nonce, payload, signature }), redirect: "manual", signal: timeout,
    });
    if ([301, 302, 303].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Missing Apps Script response redirect");
      const url = new URL(location);
      if (url.protocol !== "https:" || url.hostname !== "script.googleusercontent.com" || url.port || url.username || url.password) throw new Error("Untrusted Apps Script response redirect");
      response = await fetch(url, { method: "GET", redirect: "manual", signal: timeout });
    }
    if (response.status === 401 || response.status === 403) return this.appsScriptAuthorizationFailure();
    if (response.status === 429) return { kind: "retry", reasonCode: "RATE_LIMIT", message: "Kênh gửi đang giới hạn lượt gửi, hệ thống sẽ thử lại." };
    if (response.status >= 400 && response.status < 500) return { kind: "skip", reasonCode: "PROVIDER_NOT_READY", message: "Cần kiểm tra URL triển khai dịch vụ email." };
    if (!response.ok) return { kind: "retry", reasonCode: "TEMPORARY_FAILURE", message: "Kênh gửi tạm thời gián đoạn, hệ thống sẽ thử lại." };
    let result: { ok?: unknown; code?: unknown };
    try { result = await response.json() as typeof result; }
    catch { return { kind: "skip", reasonCode: "PROVIDER_NOT_READY", message: "Dịch vụ email chưa trả phản hồi hợp lệ; cần kiểm tra bản triển khai." }; }
    if (result.ok === true) return { kind: "sent" };
    if (result.code === "UNAUTHORIZED") return this.appsScriptAuthorizationFailure();
    if (result.code === "NOT_CONFIGURED") return { kind: "skip", reasonCode: "PROVIDER_NOT_READY", message: "Dịch vụ email chưa được cấu hình khóa xác thực." };
    if (result.code === "INVALID") return { kind: "skip", reasonCode: "PERMANENT_FAILURE", message: "Dịch vụ email từ chối định dạng thông báo." };
    if (result.code === "EXPIRED") return { kind: "skip", reasonCode: "EXPIRED", message: "Thông báo đã hết thời hạn gửi." };
    if (result.code === "RATE_LIMIT") return { kind: "retry", reasonCode: "RATE_LIMIT", message: "Kênh gửi đang giới hạn lượt gửi, hệ thống sẽ thử lại." };
    return { kind: "retry", reasonCode: "TEMPORARY_FAILURE", message: "Kênh gửi tạm thời gián đoạn, hệ thống sẽ thử lại." };
  }

  /** Giữ payload để quản trị viên thử lại sau khi sửa quyền, ghi rõ lỗi cấu hình thay vì lỗi mạng. */
  private appsScriptAuthorizationFailure(): NotificationSendResult {
    return { kind: "retry", reasonCode: "PROVIDER_AUTH_FAILED", message: "Dịch vụ email chưa cấp quyền cho máy chủ; cần kiểm tra quyền triển khai và khóa xác thực." };
  }
}

/** Gửi Web Push tới toàn bộ subscription đang hoạt động của đúng tài khoản nhận
 * Endpoint hỏng vĩnh viễn được thu hồi; subscription khác vẫn được thử độc lập để không mất thiết bị còn dùng được
 */
@Injectable()
export class WebPushNotificationProvider implements NotificationProvider {
  readonly channel = "WEB_PUSH" as const;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(ConfigService) private readonly config: ConfigService) {}
  /** Chỉ xác nhận có subscription còn hiệu lực, không tiết lộ endpoint ra ngoài service */
  async resolveRecipient(userId: string): Promise<boolean> {
    if (this.config.get<boolean>("WEB_PUSH_ENABLED") !== true) return false;
    return (await this.prisma.webPushSubscription.count({ where: { userId, revokedAt: null, user: { isActive: true } } })) > 0;
  }
  /** Ký payload bằng VAPID và gỡ subscription trả 404/410 để retry không lặp tới thiết bị đã hết hạn */
  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    if (this.config.get<boolean>("WEB_PUSH_ENABLED") !== true) return { kind: "skip", reasonCode: "PROVIDER_NOT_READY", message: "Kênh gửi chưa được cấu hình." };
    try {
      webpush.setVapidDetails(this.config.getOrThrow("WEB_PUSH_SUBJECT"), this.config.getOrThrow("WEB_PUSH_VAPID_PUBLIC_KEY"), this.config.getOrThrow("WEB_PUSH_VAPID_PRIVATE_KEY"));
      const rows = await this.prisma.webPushSubscription.findMany({ where: { userId: request.userId, revokedAt: null, user: { isActive: true } }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
      if (!rows.length) return { kind: "skip", reasonCode: "RECIPIENT_MISSING", message: "Người nhận chưa có địa chỉ hoặc thiết bị phù hợp." };
      const user = await this.prisma.user.findUnique({ where: { id: request.userId }, select: { role: true, isActive: true, credentialVersion: true, mustChangePassword: true } });
      if (request.credentialVersion !== undefined && (!user?.isActive || user.credentialVersion !== request.credentialVersion || !user.mustChangePassword)) return { kind: "skip", reasonCode: "CREDENTIAL_CHANGED", message: "Thông tin đăng nhập đã thay đổi." };
      const url = request.refType === "CREDENTIAL" ? "/login" : user?.role === "UNIT" ? "/unit/notifications" : "/admin/notifications";
      const allowed = (this.config.get<string>("WEB_PUSH_ALLOWED_HOSTS")?.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean) ?? ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-pn1p.notify.windows.com"]);
      const outcomes = await Promise.all(rows.map(async (row) => {
        // Subscription cũ trong DB vẫn phải qua allowlist trước khi worker gọi mạng
        let trusted = false;
        try { const url = new URL(row.endpoint); trusted = url.protocol === "https:" && !url.port && allowed.includes(url.hostname.toLowerCase()); } catch { trusted = false; }
        if (!trusted) return "invalid";
        // TTL không vượt deadline đã lưu để dịch vụ push không giữ nhắc quá hạn sau khi nhận
        // Làm tròn xuống, nếu còn chưa đầy một giây thì bỏ gửi thay vì kéo dài sang sau hạn
        const ttl = request.expiresAt ? Math.min(3600, Math.floor((request.expiresAt.getTime() - Date.now()) / 1000)) : 3600;
        if (ttl <= 0) return "deadline";
        try { await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify({ title: request.title, body: request.body, notificationId: request.notificationId, url }), { timeout: 8000, TTL: ttl }); return "sent"; }
        catch (error) { const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0; if (status === 404 || status === 410) { await this.prisma.webPushSubscription.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date(), updatedAt: new Date() } }); return "expired"; } return status === 429 ? "rate_limit" : "retry"; }
      }));
      if (outcomes.includes("sent")) return { kind: "sent" };
      if (outcomes.includes("rate_limit")) return { kind: "retry", reasonCode: "RATE_LIMIT", message: "Kênh gửi đang giới hạn lượt gửi, hệ thống sẽ thử lại." };
      if (outcomes.includes("retry")) return { kind: "retry", reasonCode: "TEMPORARY_FAILURE", message: "Kênh gửi tạm thời gián đoạn, hệ thống sẽ thử lại." };
      if (outcomes.includes("deadline")) return { kind: "skip", reasonCode: "EXPIRED", message: "Thông báo đã hết thời hạn gửi." };
      return { kind: "skip", reasonCode: "RECIPIENT_MISSING", message: "Người nhận chưa có địa chỉ hoặc thiết bị phù hợp." };
    } catch { return { kind: "retry", reasonCode: "PROVIDER_ERROR", message: "Không thể gửi thông báo qua kênh này, hệ thống sẽ thử lại." }; }
  }
}
