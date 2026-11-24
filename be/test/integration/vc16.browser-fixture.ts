import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { createVc12Harness } from "./vc12-support.js";

/** Chuẩn bị Nest/PostgreSQL riêng cho nghiệm thu FE hai vai trò, không reset dữ liệu đã có
 * Đầu ra gồm credential thử trong thư mục bỏ qua Git, kỳ thẩm định, kỳ mở và kỳ chờ
 * Các provider ngoài đều tắt, fixture không có email/phone của người thật
 */
async function startFixture() {
  const h = await createVc12Harness({ url: process.env.VC16_TEST_DATABASE_URL, name: "vc16_test" });
  const review = await h.scenario(2);
  await h.prisma.evaluationPeriod.update({ where: { id: review.periodId }, data: { name: "Kỳ thẩm định VC16" } });

  /** Tạo điều kiện trước của hồ sơ DRAFT với trigger thật và một lá chưa chấm
   * start tương lai dành cho phép thử không lộ tiêu chí, mọi thời gian tính từ server fixture
   * Không chèn trạng thái nộp hoặc điểm thẩm định giả để coi là nghiệp vụ đã chạy
   */
  async function draftPeriod(name: string, start: Date) {
    const now = new Date(); const periodId = randomUUID(); const criterionId = randomUUID(); const evaluationId = randomUUID();
    const maximum = await h.prisma.evaluationPeriod.aggregate({ _max: { year: true } });
    await h.prisma.evaluationPeriod.create({ data: { id: periodId, name, year: maximum._max.year! + 1, phase: "SELF_EVAL", maxTotalScore: 100, publishedAt: now, selfEvalStart: start, selfEvalDeadline: new Date(+start + 3600000), createdById: h.adminId, createdAt: now, updatedAt: now } });
    await h.prisma.criterion.create({ data: { id: criterionId, periodId, code: "VC16", name: `${name} — Nội dung tiêu chí`, maxScore: 100, evidenceRequired: false, sortOrder: 1, createdAt: now, updatedAt: now } });
    await h.prisma.ratingThreshold.createMany({ data: [{ rating: "EXCELLENT", label: "Xuất sắc", minPercent: 85, minExclusive: true }, { rating: "GOOD", label: "Tốt", minPercent: 65, minExclusive: false }, { rating: "PASS", label: "Đạt", minPercent: 50, minExclusive: false }, { rating: "FAIL", label: "Chưa đạt", minPercent: 0, minExclusive: false }].map((row) => ({ ...row, id: randomUUID(), periodId })) });
    await h.prisma.evaluation.create({ data: { id: evaluationId, periodId, unitId: review.records[0]!.unitId, status: "DRAFT", createdAt: now, updatedAt: now } });
    await h.prisma.criterionScore.create({ data: { id: randomUUID(), evaluationId, criterionId, createdAt: now, updatedAt: now } });
    return { periodId, criterionId, evaluationId };
  }
  const open = await draftPeriod("Kỳ đang tự chấm VC16", new Date(Date.now() - 60000));
  const waiting = await draftPeriod("Kỳ chờ mở VC16", new Date(Date.now() + 86400000));
  const unit = review.records[0]!;
  await h.prisma.user.update({ where: { id: unit.userId }, data: { passwordHash: await bcrypt.hash("123456", 4), mustChangePassword: true } });
  await mkdir(".tmp", { recursive: true });
  await writeFile(".tmp/vc16-browser-state.json", JSON.stringify({ base: h.base, username: h.username, password: h.password, review, open, waiting, unit }));
  process.stdout.write("Backend kiểm chứng VC16 đã sẵn sàng trên loopback, các kênh gửi ngoài đều tắt\n");

  /** Dừng tài nguyên khi kết thúc fixture, giữ nguyên DB riêng để kiểm tra hậu điều kiện */
  process.on("SIGINT", () => { void h.app.close().then(() => process.exit(0)); });
}

/** Lỗi dựng fixture chỉ báo câu cố định, không in chuỗi kết nối hoặc ngoại lệ Prisma ra terminal */
startFixture().catch(() => { process.stderr.write("Không thể khởi động fixture VC16, hãy kiểm tra database thử riêng và cổng loopback\n"); process.exit(1); });
