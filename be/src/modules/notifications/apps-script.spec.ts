import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

test("Apps Script chỉ gửi request có chữ ký, chặn replay và gửi lại cùng công việc", () => {
  const secret = "ab".repeat(32);
  const properties: Record<string, string> = { APPS_SCRIPT_SECRET: secret };
  const cache: Record<string, string> = {};
  const sent: Array<{ to: string }> = [];
  let quota = 10;
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key], setProperty: (key: string, value: string) => { properties[key] = value; }, getProperties: () => ({ ...properties }), deleteProperty: (key: string) => { delete properties[key]; } }) },
    CacheService: { getScriptCache: () => ({ get: (key: string) => cache[key], put: (key: string, value: string) => { cache[key] = value; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    Utilities: { Charset: { UTF_8: "UTF-8" }, computeHmacSha256Signature: (value: string, key: string) => [...createHmac("sha256", key).update(value).digest()], base64DecodeWebSafe: (value: string) => { assert.equal(value.length % 4, 0); return Buffer.from(value, "base64url"); }, newBlob: (value: Buffer) => ({ getDataAsString: () => value.toString("utf8") }) },
    MailApp: { getRemainingDailyQuota: () => quota, sendEmail: (message: { to: string }) => sent.push(message) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (value: string) => ({ setMimeType: () => value }) },
  };
  const code = readFileSync(new URL("../../../integrations/apps-script/Code.gs", import.meta.url), "utf8");
  const handle = runInNewContext(`${code}\ndoPost`, context) as (event: { postData: { contents: string } }) => string;
  const message = { id: randomUUID(), to: "unit@example.com", subject: "Thông báo", text: "Nội dung", html: "<p>Nội dung</p>", expiresAt: null };
  const sign = (value: typeof message, nonce = randomUUID()) => {
    const timestamp = String(Date.now()); const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return { timestamp, nonce, payload, signature: createHmac("sha256", secret).update(`${timestamp}.${nonce}.${payload}`).digest("hex") };
  };
  const send = (request: ReturnType<typeof sign>) => JSON.parse(handle({ postData: { contents: JSON.stringify(request) } })) as { ok: boolean; code: string };
  const invalid = sign(message); invalid.signature = "0".repeat(64);
  assert.equal(send(invalid).code, "UNAUTHORIZED");
  const stale = sign(message); stale.timestamp = String(Date.now() - 301000);
  assert.equal(send(stale).code, "INVALID");
  assert.equal(send(sign({ ...message, to: "unit@example.com,other@example.com" })).code, "INVALID");
  const first = sign(message);
  assert.equal(send(first).code, "SENT");
  assert.equal(sent.length, 1);
  assert.equal(send(first).code, "REPLAY");
  assert.equal(send(sign(message)).code, "ALREADY_SENT");
  assert.equal(sent.length, 1);
  quota = 0;
  assert.equal(send(sign({ ...message, id: randomUUID() })).code, "RATE_LIMIT");
  assert.equal(sent.length, 1);
});
