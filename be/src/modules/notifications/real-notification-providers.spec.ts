import assert from "node:assert/strict";
import { test } from "node:test";
import webpush from "web-push";
import nodemailer from "nodemailer";
import { EmailNotificationProvider, WebPushNotificationProvider } from "./real-notification-providers.js";

/** Kiểm TTL được truyền cho thư viện push bằng endpoint giả và không gọi mạng
 * Deadline trong tương lai giới hạn thời gian lưu, deadline hết hạn không gọi provider
 * Mọi hàm thư viện được khôi phục sau test để không ảnh hưởng các ca kiểm tra khác
 */
test("Web Push không giữ thông báo nhạy thời gian quá deadline", async () => {
  const originalSend = webpush.sendNotification; const originalVapid = webpush.setVapidDetails;
  const seen: number[] = [];
  let limited = false;
  webpush.setVapidDetails = (() => undefined) as typeof webpush.setVapidDetails;
  webpush.sendNotification = (async (_subscription, _payload, options) => { seen.push(options?.TTL ?? -1); if (limited) throw { statusCode: 429 }; return {} as never; }) as typeof webpush.sendNotification;
  try {
    const config = { get: (name: string) => name === "WEB_PUSH_ENABLED" ? true : undefined, getOrThrow: () => "fixture" };
    const db = { webPushSubscription: { findMany: async () => [{ id: "subscription", endpoint: "https://fcm.googleapis.com/test", p256dh: "fixture", auth: "fixture" }] }, user: { findUnique: async () => ({ role: "UNIT" }) } };
    const provider = new WebPushNotificationProvider(db as never, config as never);
    const request = { userId: "user", notificationId: "notice", title: "Nhắc hạn", body: "Nội dung thử", refType: null, refId: null };
    assert.equal((await provider.send({ ...request, expiresAt: new Date(Date.now() + 120000) })).kind, "sent");
    assert.ok(seen[0]! > 0 && seen[0]! <= 120);
    assert.deepEqual(await provider.send({ ...request, expiresAt: new Date(Date.now() - 1000) }), { kind: "skip", reasonCode: "EXPIRED", message: "Thông báo đã hết thời hạn gửi." });
    assert.equal(seen.length, 1);
    // Khi provider báo hết hạn mức, giữ nhánh thử lại với mã ổn định thay vì bỏ delivery
    limited = true;
    assert.deepEqual(await provider.send(request), { kind: "retry", reasonCode: "RATE_LIMIT", message: "Kênh gửi đang giới hạn lượt gửi, hệ thống sẽ thử lại." });
  } finally { webpush.sendNotification = originalSend; webpush.setVapidDetails = originalVapid; }
});

/** Kiểm SMTP báo 452 được chuyển thành lỗi hạn mức có thể retry mà không lộ dữ liệu provider
 * Transport giả chạy trong bộ nhớ, không mở socket và được khôi phục sau phép thử
 */
test("SMTP báo hết hạn mức được thử lại an toàn", async () => {
  const original = nodemailer.createTransport;
  nodemailer.createTransport = (() => ({ sendMail: async () => { throw { responseCode: 452 }; } })) as never;
  try {
    const db = { user: { findUnique: async () => ({ email: "test@example.invalid", isActive: true }) } };
    const config = { get: (name: string) => name === "EMAIL_ENABLED" ? true : name === "SMTP_HOST" ? "localhost" : undefined, getOrThrow: () => "fixture" };
    const provider = new EmailNotificationProvider(db as never, config as never);
    const result = await provider.send({ userId: "user", notificationId: "notice", title: "Thử gửi", body: "Nội dung thử", refType: null, refId: null });
    assert.deepEqual(result, { kind: "retry", reasonCode: "RATE_LIMIT", message: "Kênh gửi đang giới hạn lượt gửi, hệ thống sẽ thử lại." });
  } finally { nodemailer.createTransport = original; }
});
