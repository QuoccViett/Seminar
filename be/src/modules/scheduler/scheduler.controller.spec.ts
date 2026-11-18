import assert from "node:assert/strict";
import { test } from "node:test";
import { SchedulerController } from "./scheduler.controller.js";
import { validateEnvironment } from "../../config/env.validation.js";

/** Cờ mặc định và môi trường production đều ngăn lệnh thủ công trước khi gọi bộ quét
 * Fixture chỉ kiểm điều kiện cấu hình, kiểm guard vai trò qua HTTP trong test PostgreSQL
 */
test("công cụ demo chỉ chạy khi bật ngoài production", async () => {
  let calls = 0;
  const runner = { run: async () => { calls += 1; return { processed: 1, failed: 0, busy: false }; } };
  const disabled = new SchedulerController(runner as never, { get: () => false } as never);
  await assert.rejects(disabled.run());
  assert.equal(calls, 0);
  const enabled = new SchedulerController(runner as never, { get: (key: string) => key === "ENABLE_DEMO_TOOLS" ? true : "test" } as never);
  assert.equal((await enabled.run()).message, "Đã hoàn tất lượt quét lịch");
  assert.equal(calls, 1);
  assert.throws(() => validateEnvironment({ NODE_ENV: "production", ENABLE_DEMO_TOOLS: true, DATABASE_URL: "postgresql://localhost/test", JWT_SECRET: "x".repeat(32), INITIAL_ACCOUNT_PASSWORD: "123456" }));
});
