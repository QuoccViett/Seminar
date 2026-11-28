import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { RuntimeCache } from "./runtime-cache.service.js";

test("cache gộp request đồng thời, xóa dữ liệu sau invalidation và không cache lỗi", async () => {
  const cache = new RuntimeCache(new ConfigService());
  let reads = 0;
  const read = async () => ++reads;
  assert.deepEqual(await Promise.all(Array.from({ length: 10 }, () => cache.remember("key", 5000, read))), Array(10).fill(1));
  cache.invalidate();
  assert.equal(await cache.remember("key", 5000, read), 2);
  await assert.rejects(cache.remember("error", 5000, async () => { throw new Error("db unavailable"); }));
  assert.equal(await cache.remember("error", 5000, read), 3);
  assert.equal(await cache.remember("key", 0, read), 4);
});

test("invalidation trong lúc query đang chạy không đưa snapshot cũ trở lại cache", async () => {
  const cache = new RuntimeCache(new ConfigService());
  let resolve!: (value: string) => void;
  const pending = cache.remember("key", 5000, () => new Promise<string>((done) => { resolve = done; }));
  await Promise.resolve();
  cache.invalidate();
  resolve("old");
  assert.equal(await pending, "old");
  assert.equal(await cache.remember("key", 5000, async () => "new"), "new");
});
