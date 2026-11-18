import assert from "node:assert/strict";
import { test } from "node:test";
import { PeriodWorkflowService } from "./period-workflow.service.js";
import { DeadlineCalculator } from "../../common/services/deadline-calculator.js";

/** Dựng snapshot tối thiểu để kiểm đầy đủ ma trận giai đoạn mà không giả transaction
 * Clock ở đúng deadline, các biến period/evaluation được sửa có chủ đích theo nhánh
 * Chỉ dùng GET options trong test này, kiểm transaction và race qua PostgreSQL riêng
 */
function fixture() {
  const clock = { now: () => new Date("2026-11-18T17:00:00Z") };
  const evaluation = {
    status: "PENDING_REVIEW", firstReviewedAt: null as Date | null,
    supplementStartAt: null as Date | null, supplementDeadline: null as Date | null,
    finalizedAt: null as Date | null, finalizedById: null as string | null,
    finalScore: null as number | null, finalPercent: null as number | null, finalRating: null as string | null,
  };
  const period = {
    phase: "SETUP", publishedAt: new Date("2026-11-17T00:00:00Z") as Date | null,
    selfEvalStart: new Date("2026-11-18T00:00:00Z"), selfEvalDeadline: clock.now(), evaluations: [evaluation],
  };
  const prisma = { evaluationPeriod: { findUnique: async () => period } };
  const service = new PeriodWorkflowService(prisma as never, {} as never, clock as never, new DeadlineCalculator(clock as never), {} as never);
  return { service, clock, period, evaluation };
}

/** Kiểm giờ mở và nhánh bỏ lỡ toàn bộ cửa sổ mà không cho mở kỳ muộn
 * SETUP trước start bị chặn, đúng start cho SELF_EVAL, đúng hạn chỉ cho FIRST_REVIEW
 * Kỳ chưa công bố không có bất kỳ cạnh chuyển giai đoạn khả dụng nào
 */
test("đồ thị mở tự chấm dùng biên thời gian server và cho khóa kỳ bỏ lỡ giờ mở", async () => {
  const { service, clock, period } = fixture();
  period.selfEvalStart = new Date(clock.now().getTime() + 1);
  assert.equal((await service.options("period")).options.some((item) => item.allowed), false);
  period.selfEvalStart = clock.now();
  period.selfEvalDeadline = new Date(clock.now().getTime() + 1);
  assert.equal((await service.options("period")).options.find((item) => item.phase === "SELF_EVAL")?.allowed, true);
  period.selfEvalStart = new Date(clock.now().getTime() - 1);
  period.selfEvalDeadline = clock.now();
  assert.deepEqual((await service.options("period")).options.filter((item) => item.allowed).map((item) => item.phase), ["FIRST_REVIEW"]);
  period.publishedAt = null;
  assert.equal((await service.options("period")).options.some((item) => item.allowed), false);
});

/** Kiểm đường có/không bổ sung cùng điều kiện thẩm định và hạn đã lưu
 * Snapshot bổ sung tương lai vẫn khóa thẩm định cuối, đúng hạn cho phép reconcile
 * Không có snapshot hợp lệ thì không cho chuyển SUPPLEMENT chỉ bằng phase request
 */
test("giai đoạn cuối chờ thẩm định lần đầu và mọi vòng bổ sung kết thúc", async () => {
  const { service, clock, period, evaluation } = fixture();
  period.phase = "FIRST_REVIEW";
  assert.equal((await service.options("period")).options.some((item) => item.allowed), false);
  evaluation.firstReviewedAt = clock.now();
  assert.deepEqual((await service.options("period")).options.filter((item) => item.allowed).map((item) => item.phase), ["FINAL_REVIEW"]);
  evaluation.status = "SUPPLEMENT_REQUESTED";
  evaluation.supplementStartAt = new Date(clock.now().getTime() + 1);
  evaluation.supplementDeadline = new Date(clock.now().getTime() + 1000);
  assert.deepEqual((await service.options("period")).options.filter((item) => item.allowed).map((item) => item.phase), ["SUPPLEMENT"]);
  period.phase = "SUPPLEMENT";
  assert.equal((await service.options("period")).options.some((item) => item.allowed), false);
  evaluation.supplementDeadline = clock.now();
  assert.equal((await service.options("period")).options.find((item) => item.phase === "FINAL_REVIEW")?.allowed, true);
});

/** Không chấp nhận trạng thái FINALIZED thiếu snapshot chốt và không mở lại CLOSED
 * Điểm 0 là kết quả hợp lệ, kiểm null thay vì truthy để không khóa hồ sơ đạt 0 điểm
 * Mọi đích chuyển từ CLOSED phải bị từ chối kể cả khi thời gian tự chấm còn mở
 */
test("đóng kỳ cần đủ kết quả cho mọi hồ sơ và giai đoạn đóng không được mở lại", async () => {
  const { service, clock, period, evaluation } = fixture();
  period.phase = "FINAL_REVIEW";
  evaluation.status = "FINALIZED";
  assert.equal((await service.options("period")).options.some((item) => item.allowed), false);
  Object.assign(evaluation, { finalizedAt: clock.now(), finalizedById: "admin", finalScore: 0, finalPercent: 0, finalRating: "FAIL" });
  assert.equal((await service.options("period")).options.find((item) => item.phase === "CLOSED")?.allowed, true);
  period.phase = "CLOSED";
  assert.equal((await service.options("period")).options.some((item) => item.allowed), false);
});

/** Lịch preview dùng helper dùng chung, trả UTC và nhãn tạm rõ ràng cho FE
 * Thứ Sáu mở 23:30 chỉ còn nửa giờ, thứ Bảy bị từ chối dù gửi trực tiếp API helper
 */
test("preview lịch tạm không cộng giờ và từ chối cuối tuần", () => {
  const { service } = fixture();
  const result = service.previewSupplement("2026-11-20T23:30:00+07:00");
  assert.equal(result.supplementDeadline, "2026-11-20T17:00:00.000Z");
  assert.match(result.displayUntil, /23:59.*20\/11\/2026/u);
  assert.throws(() => service.previewSupplement("2026-11-21T00:00:00+07:00"));
});
