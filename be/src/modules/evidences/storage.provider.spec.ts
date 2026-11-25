import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { StorageProvider } from "./storage.provider.js";

const key = "pending/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const config = () => new ConfigService({ STORAGE_ENABLED: true, STORAGE_PROVIDER: "supabase", SUPABASE_URL: "https://storage.example.invalid", SUPABASE_KEY: "fixture-key-private", STORAGE_BUCKET: "evidences" });

/** Object thiếu có thể được Supabase trả HTTP 400, thao tác dọn lặp vẫn phải thành công */
test("Supabase đọc thiếu và xóa lặp nhận diện mã object mà không lộ body provider", async () => {
  const original = globalThis.fetch;
  try {
    for (const missing of [() => new Response(null, { status: 404 }), () => Response.json({ statusCode: "404", message: "fixture-key-private" }, { status: 400 }), () => Response.json({ code: "NoSuchKey" }, { status: 400 }), () => Response.json({ code: "not_found" }, { status: 400 })]) {
      globalThis.fetch = (async (input: string | URL | Request) => String(input).includes("/bucket/") ? Response.json({ public: false }) : missing()) as typeof fetch;
      const storage = new StorageProvider(config());
      assert.equal(await storage.get(key), null);
      await storage.remove(key);
    }
    globalThis.fetch = (async (input: string | URL | Request) => String(input).includes("/bucket/") ? Response.json({ public: false }) : new Response("fixture-key-private", { status: 400 })) as typeof fetch;
    await assert.rejects(new StorageProvider(config()).get(key), error => {
      assert.doesNotMatch(JSON.stringify(error), /fixture-key-private/); return true;
    });
  } finally { globalThis.fetch = original; }
});

/** Giới hạn số byte thực đọc bảo vệ khi provider không trả hoặc khai gian Content-Length */
test("Supabase từ chối stream quá 10 MiB và lỗi mạng bằng thông báo an toàn", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: string | URL | Request) => String(input).includes("/bucket/") ? Response.json({ public: false }) : new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { "content-length": "1" } })) as typeof fetch;
    await assert.rejects(new StorageProvider(config()).get(key), /Kho tệp chưa sẵn sàng/);
    globalThis.fetch = (async () => { throw new Error("fixture-key-private provider error"); }) as typeof fetch;
    for (const work of [() => new StorageProvider(config()).get(key), () => new StorageProvider(config()).put(key, Buffer.from("bytes"), "application/pdf"), () => new StorageProvider(config()).remove(key)]) {
      await assert.rejects(work(), error => { assert.doesNotMatch(JSON.stringify(error), /fixture-key-private|provider error/); return true; });
    }
  } finally { globalThis.fetch = original; }
});
