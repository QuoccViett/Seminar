import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { installHttpSecurity } from "./http-security.js";

test("HTTP giới hạn login theo username chuẩn hóa, trả tiếng Việt và không cache", async () => {
  const app = express(); app.use(express.json({ limit: "1mb" }));
  installHttpSecurity(app, { trustProxy: false, rateLimit: true, loginLimit: 2 });
  app.post("/api/v1/auth/login", (_req, res) => res.sendStatus(200));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const request = (username: string) => fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.10" }, body: JSON.stringify({ username }) });
  try {
    assert.equal((await request(" Test ")).status, 200);
    assert.equal((await request("test")).status, 200);
    const blocked = await request("TEST");
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get("cache-control"), "no-store");
    assert.ok(blocked.headers.get("retry-after"));
    assert.equal((await blocked.json() as { code: string }).code, "RATE_LIMITED");
    assert.equal((await request("different")).status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
