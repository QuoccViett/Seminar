import assert from "node:assert/strict";
import { test } from "node:test";
import webpush from "web-push";
import nodemailer from "nodemailer";
import { createHmac } from "node:crypto";
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

test("Apps Script ký nội dung và chỉ theo redirect Google an toàn", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let resultCode = "SENT";
  let redirectHost = "script.googleusercontent.com";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.startsWith("https://script.google.com/")) return new Response(null, { status: 302, headers: { location: `https://${redirectHost}/macros/echo` } });
    return new Response(JSON.stringify({ ok: resultCode === "SENT", code: resultCode }), { status: 200 });
  }) as typeof fetch;
  try {
    const values: Record<string, string | boolean> = { EMAIL_ENABLED: true, EMAIL_PROVIDER: "apps_script", MAIL_FROM: "admin@example.com", APPS_SCRIPT_URL: "https://script.google.com/macros/s/fixture/exec", APPS_SCRIPT_SECRET: "ab".repeat(32) };
    const config = { get: (name: string) => values[name], getOrThrow: (name: string) => values[name] };
    const db = { user: { findUnique: async () => ({ email: "unit@example.com", isActive: true }) } };
    const provider = new EmailNotificationProvider(db as never, config as never);
    const request = { userId: "user", notificationId: "00000000-0000-4000-8000-000000000001", title: "Nhắc hạn", body: "Nội dung <script>", refType: null, refId: null };
    assert.deepEqual(await provider.send(request), { kind: "sent" });
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.url, "https://script.googleusercontent.com/macros/echo");
    assert.equal(calls[1]?.init?.method, "GET");
    const signed = JSON.parse(String(calls[0]?.init?.body)) as { timestamp: string; nonce: string; payload: string; signature: string };
    assert.equal(signed.signature, createHmac("sha256", String(values.APPS_SCRIPT_SECRET)).update(`${signed.timestamp}.${signed.nonce}.${signed.payload}`).digest("hex"));
    const payload = JSON.parse(Buffer.from(signed.payload, "base64url").toString("utf8"));
    assert.equal(payload.to, "unit@example.com");
    assert.equal(payload.id, request.notificationId);
    assert.match(payload.html, /&lt;script&gt;/);
    resultCode = "RATE_LIMIT";
    assert.deepEqual(await provider.send(request), { kind: "retry", reasonCode: "RATE_LIMIT", message: "Kênh gửi đang giới hạn lượt gửi, hệ thống sẽ thử lại." });
    resultCode = "UNAUTHORIZED";
    assert.equal((await provider.send(request)).kind, "retry");
    assert.equal((await provider.send(request) as { reasonCode: string }).reasonCode, "PROVIDER_AUTH_FAILED");
    redirectHost = "attacker.invalid";
    assert.equal((await provider.send(request)).kind, "retry");
    assert.equal(calls.at(-1)?.url, "https://script.google.com/macros/s/fixture/exec");
    const before = calls.length;
    assert.equal((await provider.send({ ...request, expiresAt: new Date(Date.now() - 1000) })).kind, "skip");
    assert.equal(calls.length, before);
  } finally { globalThis.fetch = originalFetch; }
});

test("Apps Script phân biệt thiếu quyền, cấu hình sai và lỗi mạng tạm thời", async () => {
  const originalFetch = globalThis.fetch;
  const values: Record<string, string | boolean> = { EMAIL_ENABLED: true, EMAIL_PROVIDER: "apps_script", MAIL_FROM: "admin@example.com", APPS_SCRIPT_URL: "https://script.google.com/macros/s/fixture/exec", APPS_SCRIPT_SECRET: "ab".repeat(32) };
  const config = { get: (name: string) => values[name], getOrThrow: (name: string) => values[name] };
  const db = { user: { findUnique: async () => ({ email: "unit@example.com", isActive: true }) } };
  const provider = new EmailNotificationProvider(db as never, config as never);
  const request = { userId: "user", notificationId: "00000000-0000-4000-8000-000000000001", title: "Kiểm quyền", body: "Thử gửi", refType: null, refId: null };
  try {
    for (const status of [401, 403]) {
      globalThis.fetch = (async () => new Response("provider-private-detail", { status })) as typeof fetch;
      const result = await provider.send(request);
      assert.equal(result.kind, "retry");
      assert.equal((result as { reasonCode: string }).reasonCode, "PROVIDER_AUTH_FAILED");
      assert.equal(JSON.stringify(result).includes("provider-private-detail"), false);
    }
    globalThis.fetch = (async () => new Response("<html>Sign in</html>")) as typeof fetch;
    assert.equal((await provider.send(request) as { reasonCode: string }).reasonCode, "PROVIDER_NOT_READY");
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    assert.equal((await provider.send(request)).kind, "retry");
    globalThis.fetch = (async () => new Response(null, { status: 429 })) as typeof fetch;
    assert.equal((await provider.send(request) as { reasonCode: string }).reasonCode, "RATE_LIMIT");
  } finally { globalThis.fetch = originalFetch; }
});
