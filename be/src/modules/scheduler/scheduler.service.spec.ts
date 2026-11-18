import assert from "node:assert/strict";
import { test } from "node:test";
import { SchedulerService } from "./scheduler.service.js";

/** Dựng transaction tối thiểu để kiểm nhánh thời gian và số lần ghi của bộ quét
 * Thời điểm được truyền vào thay giờ DB, các hàng có thể đổi trạng thái sau mỗi lượt
 * Fixture không chứng minh khóa cạnh tranh PostgreSQL hoặc giao hàng qua provider thật
 */
function fixture(now: Date) {
  const period = { id: "period", name: "Năm học", phase: "SETUP", publishedAt: new Date("2026-11-01Z"), selfEvalStart: new Date("2026-11-18T00:00:00Z"), selfEvalDeadline: new Date("2026-11-20T00:00:00Z") };
  const evaluation = { id: "evaluation", unitId: "unit", status: "DRAFT", supplementStartAt: null as Date | null, supplementDeadline: null as Date | null };
  const events: string[] = [];
  const tx = {
    $queryRaw: async () => [],
    evaluationPeriod: { findUnique: async () => period, update: async ({ data }: { data: { phase: string } }) => { period.phase = data.phase; } },
    evaluation: { findMany: async () => [evaluation], update: async ({ data }: { data: { status: string } }) => { evaluation.status = data.status; } },
    user: { findMany: async () => [{ id: "unit-user", role: "UNIT", unitId: "unit" }] },
    statusHistory: { create: async () => { events.push("history"); } },
  };
  const prisma = { $transaction: async (fn: (value: typeof tx) => Promise<void>) => fn(tx) };
  const state = { databaseNow: async () => now, reconcileInitial: async () => { if (evaluation.status === "DRAFT") { evaluation.status = "PENDING_REVIEW"; events.push("lock"); } }, reconcileSupplement: async () => { evaluation.status = "SUPPLEMENT_EXPIRED"; events.push("history"); } };
  const notifications = { notifyUser: async (_tx: unknown, item: { type: string }) => { events.push(item.type); } };
  const audit = { record: async () => { events.push("audit"); } };
  return { service: new SchedulerService(prisma as never, audit as never, state as never, notifications as never), period, evaluation, events };
}

/** Mất toàn bộ cửa sổ phải khóa trực tiếp và lượt quét lại không sinh thêm dấu vết
 * Biên deadline là thời điểm loại trừ, không được tạo thông báo mở kỳ đã muộn
 */
test("khóa kỳ bỏ lỡ cửa sổ và xử lý lặp không tạo sự kiện mới", async () => {
  const { service, period, events } = fixture(new Date("2026-11-20T00:00:00Z"));
  await service.processPeriod("period");
  assert.equal(period.phase, "FIRST_REVIEW");
  assert.deepEqual(events, ["lock", "audit", "PERIOD_PHASE_CHANGED"]);
  await service.processPeriod("period");
  assert.equal(events.length, 3);
});

/** Kiểm đúng mốc mở và hết hạn bổ sung, chỉ hồ sơ còn yêu cầu được chuyển trạng thái
 * Không tự finalize và không tính lại deadline bằng cấu hình số giờ cũ
 */
test("mở đúng mốc và hết hạn bổ sung đúng snapshot", async () => {
  const { service, period, evaluation, events } = fixture(new Date("2026-11-18T00:00:00Z"));
  await service.processPeriod("period");
  assert.equal(period.phase, "SELF_EVAL");
  evaluation.status = "SUPPLEMENT_REQUESTED";
  evaluation.supplementStartAt = new Date("2026-11-17T00:00:00Z");
  evaluation.supplementDeadline = new Date("2026-11-18T00:00:00Z");
  await service.processPeriod("period");
  assert.equal(evaluation.status, "SUPPLEMENT_EXPIRED");
  assert.equal(events.filter((item) => item === "history").length, 1);
  await service.processPeriod("period");
  assert.equal(events.filter((item) => item === "history").length, 1);
});

/** Nhắc hạn chỉ xuất hiện tại mốc hợp lệ bên trong cửa sổ và không nhắc vòng ngắn
 * Ví dụ bổ sung mở sau mốc 24 giờ phản ánh quy tắc thứ Sáu theo lịch tạm
 */
test("nhắc hạn đúng cửa sổ và bỏ mốc trước giờ mở bổ sung", async () => {
  const first = fixture(new Date("2026-11-19T00:00:00Z"));
  first.period.phase = "SELF_EVAL";
  await first.service.processPeriod("period");
  assert.equal(first.events.filter((item) => item === "SELF_EVAL_REMINDER").length, 1);
  const second = fixture(new Date("2026-11-19T00:00:00Z"));
  second.period.phase = "SUPPLEMENT";
  second.evaluation.status = "SUPPLEMENT_REQUESTED";
  second.evaluation.supplementStartAt = new Date("2026-11-19T01:00:00Z");
  second.evaluation.supplementDeadline = new Date("2026-11-20T00:00:00Z");
  await second.service.processPeriod("period");
  assert.equal(second.events.includes("SUPPLEMENT_REMINDER"), false);
});
