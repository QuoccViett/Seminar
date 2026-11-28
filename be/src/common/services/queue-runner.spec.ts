import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { drainQueue } from "./queue-runner.js";

test("worker chạy đồng thời có giới hạn, lỗi một việc không bỏ các việc còn lại", async () => {
  const queue = Array.from({ length: 23 }, (_, index) => index);
  const seen = new Set<number>();
  let active = 0; let peak = 0; let errors = 0;
  const count = await drainQueue({ concurrency: 5, budgetMs: 5000, limit: 100,
    claim: async () => queue.shift() ?? null,
    process: async (item) => { active += 1; peak = Math.max(peak, active); await setTimeout(2); active -= 1; assert.ok(!seen.has(item)); seen.add(item); if (item === 7) throw new Error("provider failed"); },
    onError: () => { errors += 1; },
  });
  assert.equal(count, 23); assert.equal(seen.size, 23); assert.equal(peak, 5); assert.equal(errors, 1);
});

test("worker hết ngân sách hoàn tất việc đang gửi và không claim thêm", async () => {
  let claims = 0; let finished = 0;
  const result = await drainQueue({ concurrency: 2, budgetMs: 10, limit: 100,
    claim: async () => ++claims, process: async () => { await setTimeout(30); finished += 1; }, onError: () => {},
  });
  assert.equal(result, 2); assert.equal(claims, 2); assert.equal(finished, 2);
});
