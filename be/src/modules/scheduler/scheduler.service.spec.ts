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
    $queryRaw: async (sql: TemplateStringsArray) => {
      if (!sql.join("").includes("FROM evaluations")) return [];
      const due = evaluation.status === "DRAFT" && now >= period.selfEvalDeadline || evaluation.status === "SUPPLEMENT_REQUESTED" && evaluation.supplementDeadline && now >= evaluation.supplementDeadline;
      return due ? [{ id: evaluation.id }] : [];
    },
    evaluationPeriod: { findUnique: async () => period, update: async ({ data }: { data: { phase: string } }) => { period.phase = data.phase; } },
    evaluation: { findMany: async () => [evaluation], update: async ({ data }: { data: { status: string } }) => { evaluation.status = data.status; } },
    user: { findMany: async () => [{ id: "unit-user", role: "UNIT", unitId: "unit" }] },
    statusHistory: { create: async () => { events.push("history"); } },
  };
  const prisma = { $transaction: async (fn: (value: typeof tx) => Promise<void>) => fn(tx) };
  const state = { databaseNow: async () => now, reconcileExpiredMany: async () => {
    if (evaluation.status === "DRAFT") { evaluation.status = "PENDING_REVIEW"; events.push("lock"); }
    else if (evaluation.status === "SUPPLEMENT_REQUESTED") { evaluation.status = "SUPPLEMENT_EXPIRED"; events.push("history"); }
  } };
  const notifications = { enqueueMany: async (_tx: unknown, items: { type: string }[]) => { for (const item of items) events.push(item.type); } };
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
  assert.deepEqual(events, ["audit", "PERIOD_PHASE_CHANGED", "lock"]);
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

/** Nhắc hạn chỉ xuất hiện tại mốc hợp lệ bên trong cửa sổ
 * Không tạo thông báo cho lịch bổ sung chưa đến giờ mở
 */
test("nhắc hạn đúng cửa sổ và không nhắc trước giờ mở bổ sung", async () => {
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

test("scheduler nhắc cả tự chấm và bổ sung ngắn tại nửa thời lượng, không nhắc khi đã nộp", async () => {
  const start = new Date("2026-11-18T00:00:00Z");
  for (const supplement of [false, true]) {
    for (const [minutes, lead] of [[10, 5], [30, 15], [120, 60], [2880, 1440], [4320, 1440]]) {
      const deadline = new Date(+start + minutes! * 60_000);
      const due = +deadline - lead! * 60_000;
      for (const offset of [-1, 0, 1]) {
        const f = fixture(new Date(due + offset));
        f.period.phase = supplement ? "SUPPLEMENT" : "SELF_EVAL";
        f.period.selfEvalStart = start;
        f.period.selfEvalDeadline = deadline;
        if (supplement) Object.assign(f.evaluation, { status: "SUPPLEMENT_REQUESTED", supplementStartAt: start, supplementDeadline: deadline });
        await f.service.processPeriod("period");
        assert.equal(f.events.includes(supplement ? "SUPPLEMENT_REMINDER" : "SELF_EVAL_REMINDER"), offset >= 0);
      }
      const f = fixture(new Date(due));
      f.evaluation.status = supplement ? "SUPPLEMENT_SUBMITTED" : "PENDING_REVIEW";
      await f.service.processPeriod("period");
      assert.equal(f.events.some((event) => event.endsWith("REMINDER")), false);
    }
  }
});
