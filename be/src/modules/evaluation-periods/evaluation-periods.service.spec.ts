import assert from "node:assert/strict";
import { test } from "node:test";
import { EvaluationPeriodsService } from "./evaluation-periods.service.js";

const periodId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-18T03:00:00.000Z");
const thresholds = [
  { rating: "EXCELLENT", label: "Xuất sắc", minPercent: 85, minExclusive: true },
  { rating: "GOOD", label: "Tốt", minPercent: 65, minExclusive: false },
  { rating: "PASS", label: "Đạt", minPercent: 50, minExclusive: false },
  { rating: "FAIL", label: "Chưa đạt", minPercent: 0, minExclusive: false },
];

/** Tạo service cô lập với đồng hồ, audit và các lời gọi Prisma giả
 * overrides thay đúng các thao tác cần theo dõi trong từng kịch bản
 * Kết quả trả thêm các lời gọi để kiểm tra không ghi khi nghiệp vụ bị từ chối
 */
function makeService(overrides: Record<string, unknown> = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const period = {
    id: periodId, year: 2026, name: "Đợt năm 2026", phase: "SETUP", maxTotalScore: 300,
    selfEvalStart: new Date("2026-11-18T03:00:00.000Z"), selfEvalDeadline: new Date("2026-11-20T03:00:00.000Z"),
    publishedAt: null, finalizedAt: null, createdById: "22222222-2222-4222-8222-222222222222",
    ratingThresholds: thresholds, criteria: [{ id: "criterion-1", parentId: null, maxScore: 300, allowText: true, allowFile: true, allowLink: true }], createdAt: now, updatedAt: now,
  };
  const prisma = {
    evaluationPeriod: {
      findUnique: async () => period,
      update: async (args: Record<string, unknown>) => { updates.push(args); return { ...period, ...(args.data as object) }; },
      updateMany: async (args: Record<string, unknown>) => { updates.push(args); return { count: 1 }; },
      findUniqueOrThrow: async () => period,
    },
    unit: {
      count: async () => 1,
      findMany: async () => [{ id: "unit-1", user: { id: "unit-user", isActive: true } }],
    },
    $transaction: async (callback: (transaction: Record<string, unknown>) => unknown) => callback({
      $queryRaw: async () => [],
      evaluationPeriod: {
        findUnique: async () => period,
        update: async (args: Record<string, unknown>) => { updates.push(args); return { ...period, ...(args.data as object) }; },
        updateMany: async (args: Record<string, unknown>) => { updates.push(args); return { count: 1 }; },
        findUniqueOrThrow: async () => period,
      },
      evaluation: { createMany: async () => ({ count: 1 }) },
      criterionScore: { createMany: async () => ({ count: 1 }) },
      unit: { count: async () => 1, findMany: async () => [{ id: "unit-1", user: { id: "unit-user", isActive: true } }] },
    }),
    ...overrides,
  };
  const clock = { now: () => new Date(now) };
  const audit = { record: async (payload: Record<string, unknown>) => { audits.push(payload); } };
  const notifications = { notifyUser: async (_transaction: unknown, input: Record<string, unknown>) => { audits.push({ action: "NOTIFY", ...input }); } };
  return { service: new EvaluationPeriodsService(prisma as never, audit as never, clock as never, notifications as never), period, updates, audits };
}

/** Ép kiểu lỗi HTTP để so sánh trạng thái và thông điệp tiếng Việt ổn định
 * error là lỗi dự kiến từ service trong các nhánh bị chặn
 * Helper không làm thay đổi lỗi hoặc che thông tin mà test cần xác nhận
 */
function response(error: unknown) {
  return error as { getStatus(): number; getResponse(): { message?: string } };
}

/** Bảo đảm UNIT không đọc được kỳ nháp và chỉ thấy cấu hình từ đúng mốc mở
 * Cố định giờ máy chủ rồi thay đổi thời điểm mở và công bố trong dữ liệu đầu vào
 * Kiểm tra cả một mili giây trước mở, đúng mở và đúng hạn để tránh phụ thuộc job
 */
test("UNIT chỉ thấy cấu hình khi kỳ đã công bố và giờ server đã tới giờ mở", async () => {
  const { service, period } = makeService();
  await assert.rejects(service.findOne(periodId, { id: "unit", role: "UNIT", unitId: "unit-1" }), (error: unknown) => response(error).getStatus() === 404);
  await assert.rejects(service.getThresholds(periodId, { id: "unit", role: "UNIT", unitId: "unit-1" }), (error: unknown) => response(error).getStatus() === 404);
  (period as { publishedAt: Date | null }).publishedAt = new Date("2026-11-17T00:00:00.000Z");
  (period as { selfEvalStart: Date | null }).selfEvalStart = new Date(now.getTime() + 1);
  const result = await service.findOne(periodId, { id: "unit", role: "UNIT", unitId: "unit-1" }) as unknown as {
    ratingThresholds: unknown[]; criteria: unknown[]; criteriaVisible: boolean; selfEvalState: string; serverTime: string; maxTotalScore?: number;
  };
  assert.deepEqual(result.ratingThresholds, []);
  assert.deepEqual(result.criteria, []);
  assert.equal(result.criteriaVisible, false);
  assert.equal(result.selfEvalState, "NOT_OPEN_YET");
  assert.equal(result.serverTime, now.toISOString());
  assert.equal(result.maxTotalScore, undefined);
  (period as { selfEvalStart: Date | null }).selfEvalStart = new Date(now);
  const visible = await service.findOne(periodId, { id: "unit", role: "UNIT", unitId: "unit-1" }) as unknown as typeof result;
  assert.equal(visible.criteria.length, 1);
  assert.equal(visible.ratingThresholds.length, 4);
  assert.equal(visible.criteriaVisible, true);
  assert.equal(visible.selfEvalState, "OPEN");
  period.selfEvalDeadline = now;
  const afterDeadline = await service.findOne(periodId, { id: "unit", role: "UNIT", unitId: "unit-1" }) as unknown as typeof result;
  assert.equal(afterDeadline.criteriaVisible, true);
  assert.equal(afterDeadline.selfEvalState, "CLOSED");
});

/** Kiểm tra bộ lọc kỳ công bố được áp dụng trước phân trang và đếm tổng
 * Prisma giả ghi lại điều kiện truy vấn của UNIT và ADMIN mà không cần sửa dữ liệu thật
 * Hai truy vấn của UNIT phải dùng cùng điều kiện để số trang không lộ kỳ nháp
 */
test("danh sách UNIT lọc kỳ nháp trước khi phân trang và đếm", async () => {
  const calls: Array<{ where: unknown }> = [];
  const prisma = {
    evaluationPeriod: {
      findMany: (args: { where: unknown }) => { calls.push(args); return Promise.resolve([]); },
      count: (args: { where: unknown }) => { calls.push(args); return Promise.resolve(0); },
    },
    $transaction: (queries: Array<Promise<unknown>>) => Promise.all(queries),
  };
  const service = new EvaluationPeriodsService(prisma as never, {} as never, { now: () => now } as never, {} as never);
  const query = { page: 1, pageSize: 20, sortOrder: "desc" as const };
  await service.findAll(query, { id: "unit", role: "UNIT", unitId: "unit-1" });
  assert.deepEqual(calls.map((call) => call.where), [{ publishedAt: { not: null } }, { publishedAt: { not: null } }]);
  calls.length = 0;
  await service.findAll(query, { id: "admin", role: "ADMIN", unitId: null });
  assert.deepEqual(calls.map((call) => call.where), [{}, {}]);
});

/** Kiểm tra PATCH ghép mốc mới với mốc đã lưu trước khi quyết định ghi
 * Thử deadline bằng và sớm hơn start vào cuối tuần, sau đó thử khoảng hợp lệ
 * Không dùng ngày làm việc của lịch bổ sung để hạn chế cửa sổ tự chấm
 */
test("PATCH lịch tự chấm kiểm thứ tự sau khi ghép và cho phép cuối tuần", async () => {
  const { service, period, updates } = makeService();
  period.selfEvalStart = new Date("2026-11-21T16:30:00.000Z");
  for (const deadline of ["2026-11-21T16:30:00Z", "2026-11-21T16:29:00Z"]) {
    await assert.rejects(service.update(periodId, { selfEvalDeadline: deadline }, "admin"), (error: unknown) => response(error).getStatus() === 400);
  }
  assert.equal(updates.length, 0);
  await service.update(periodId, { selfEvalDeadline: "2026-11-21T17:00:00Z" }, "admin");
  assert.equal(updates.length, 1);
});

/** Kiểm tra thao tác publish tự ghi thời gian server và ghi audit
 * Dùng kỳ có lịch, tiêu chí, ngưỡng và đơn vị hợp lệ
 * Xác nhận thời gian do service cấp thay vì nhận từ request
 */
test("công bố tự cấp dấu thời gian theo server sau khi đủ cấu hình", async () => {
  const { service, updates, audits } = makeService();
  await service.publish(periodId, "admin-1");
  assert.equal((updates[0]?.data as { publishedAt: Date }).publishedAt.getTime(), now.getTime());
  assert.equal(audits[0]?.action, "PUBLISH");
});

/** Buộc lịch đã công bố phải có lý do, audit và thông báo SYSTEM đồng bộ
 * Kỳ mẫu đã công bố nhưng mốc mở còn ở tương lai theo đồng hồ backend
 * Xác nhận thông báo có giờ Việt Nam và không bật delivery ngoài
 */
test("đổi lịch đã công bố cần lý do và tạo hộp thư nội bộ trong transaction", async () => {
  const { service, period, audits } = makeService();
  (period as { publishedAt: Date | null }).publishedAt = new Date("2026-11-17T03:00:00.000Z");
  period.selfEvalStart = new Date("2026-11-19T03:00:00.000Z");
  period.selfEvalDeadline = new Date("2026-11-21T03:00:00.000Z");
  const result = await service.update(periodId, {
    selfEvalDeadline: "2026-11-22T03:00:00.000Z",
    changeReason: "Điều chỉnh theo thông báo của đơn vị",
  }, "admin-1");
  assert.equal(result.selfEvalDeadline?.toISOString(), "2026-11-22T03:00:00.000Z");
  assert.equal(audits.some((entry) => entry.action === "UPDATE"), true);
  const notification = audits.find((entry) => entry.action === "NOTIFY");
  assert.equal((notification?.channels as unknown[] | undefined)?.length, 0);
  assert.match(String(notification?.body), /giờ Việt Nam/u);
});

/** Chặn publish khi bộ ngưỡng thiếu một mức và bảo đảm chưa ghi trạng thái
 * Bỏ mức EXCELLENT khỏi kỳ đã chuẩn bị đủ các điều kiện còn lại
 * Kiểm tra lỗi công bố tiếng Việt cùng việc chưa chạy cập nhật DB
 */
test("không công bố khi thiếu ngưỡng chuẩn", async () => {
  const { service, period, updates } = makeService();
  period.ratingThresholds = thresholds.slice(1);
  await assert.rejects(service.publish(periodId, "admin-1"), (error: unknown) =>
    response(error).getStatus() === 422 && response(error).getResponse().message === "Cấu hình kỳ chưa đủ điều kiện công bố.",
  );
  assert.equal(updates.length, 0);
});

/** Chặn công bố muộn để không tạo kỳ SELF_EVAL có toàn bộ cửa sổ đã qua
 * Cấu hình còn lại hợp lệ, deadline đặt đúng clock server là mốc loại trừ
 * Checklist phải chỉ rõ lịch đã hết hạn và không có thao tác ghi trong transaction
 */
test("không công bố kỳ đã đến deadline dù cấu hình khác đầy đủ", async () => {
  const { service, period, updates } = makeService();
  period.selfEvalStart = new Date(now.getTime() - 1000);
  period.selfEvalDeadline = now;
  const check = await service.getPublishCheck(periodId);
  assert.equal(check.checks.find((item) => item.code === "notExpired")?.passed, false);
  await assert.rejects(service.publish(periodId, "admin"), (error: unknown) => response(error).getStatus() === 422);
  assert.equal(updates.length, 0);
});
