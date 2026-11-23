import "reflect-metadata";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../src/prisma/prisma.service.js";

const executeFile = promisify(execFile);

/** Tính dấu vân tay snapshot để assertion không in mật khẩu hash hoặc nội dung fixture ra log CI
 * Date/Decimal dùng JSON chuẩn, BigInt đổi thành chuỗi và không làm thay đổi đối tượng đầu vào
 */
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)).digest("hex");
}

/** Chạy seed thật hai lần trên PostgreSQL riêng đã migrate đủ bảy migration
 * Lần đầu kiểm dựng DRAFT → PENDING_REVIEW trước bổ sung/chốt và khôi phục lịch/phase lịch sử
 * Lần sau kiểm không reset submittedAt, không thay điểm/minh chứng và không thêm history/audit trùng
 * Chỉ chấp nhận ci_seed hoặc seed_test có hậu tố, DB phải trống để không ghi vào dữ liệu đang dùng
 * Không tắt trigger, không reset DB, không gọi API gửi thông báo hoặc lưu credential trong repository
 */
test("seed qua trigger VC09 trên DB trống và chạy lại giữ nguyên hồ sơ", { timeout: 300_000 }, async () => {
  const databaseUrl = process.env.SEED_TEST_DATABASE_URL;
  assert.ok(databaseUrl, "Cần cấu hình SEED_TEST_DATABASE_URL trỏ tới database kiểm thử riêng");
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  assert.match(databaseName, /^(?:ci_seed|seed_test(?:_[a-z0-9]+)?)$/, "Chỉ được kiểm seed trên ci_seed hoặc seed_test riêng");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  const directory = await mkdtemp(join(tmpdir(), "seminar-seed-test-"));
  const credentialsFile = join(directory, "credentials.json");
  const cleanupTarget = resolve(directory);
  assert.ok(cleanupTarget.startsWith(resolve(tmpdir()) + sep) && basename(cleanupTarget).startsWith("seminar-seed-test-"), "Đích dọn test phải nằm trong thư mục tạm được tạo");


  /** Chạy đúng entrypoint tsx của npm run db:seed với env độc lập cho tài khoản và credential tạm
   * Giữ DB cùng đích kiểm thử, cố định UTC như CI Linux và không truyền mật khẩu trên command line
   * Thu stdout thay vì in credential, giới hạn thời gian từng lần seed để lỗi treo không giữ CI vô hạn
   */
  async function seed() {
    return executeFile(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
      cwd: process.cwd(), timeout: 180_000,
      env: { ...process.env, DATABASE_URL: databaseUrl, SEED_DEMO_ENABLED: "true", NODE_ENV: "test", STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: join(directory, "storage"), TZ: "UTC", SEED_ADMIN_USERNAME: "admin", SEED_ADMIN_EMAIL: "admin@seminar.local", SEED_ADMIN_PASSWORD: "ci-only-seed-password", SEED_CREDENTIALS_FILE: credentialsFile, SEED_ROTATE_PASSWORDS: "false" },
    });
  }

  /** Chụp nội dung hồ sơ và các bảng con theo thứ tự ổn định, chỉ trả checksum cho assertion
   * Không gồm timestamp cấu hình kỳ/đơn vị vì seed có thể cập nhật metadata danh mục khi chạy lại
   * Có passwordHash/version để chứng minh seed không xoay vòng credential khi cờ xoay vòng tắt
   */
  async function snapshot() {
    return digest({
      users: await prisma.user.findMany({ select: { id: true, passwordHash: true, mustChangePassword: true, credentialVersion: true }, orderBy: { id: "asc" } }),
      evaluations: await prisma.evaluation.findMany({ orderBy: { id: "asc" } }),
      scores: await prisma.criterionScore.findMany({ orderBy: { id: "asc" } }),
      evidences: await prisma.evidence.findMany({ orderBy: { id: "asc" } }),
      feedbacks: await prisma.evaluationFeedback.findMany({ orderBy: { id: "asc" } }),
      history: await prisma.statusHistory.findMany({ orderBy: { id: "asc" } }),
      audit: await prisma.auditLog.findMany({ orderBy: { id: "asc" } }),
    });
  }

  try {
    assert.equal(await prisma.user.count(), 0, "Database kiểm seed phải trống trước khi chạy");
    assert.equal(await prisma.evaluationPeriod.count(), 0, "Database kiểm seed không được có kỳ đang sử dụng");
    assert.match((await seed()).stdout, /Đã tạo dữ liệu mẫu/u);
    assert.equal(await prisma.unit.count(), 34);
    assert.equal(await prisma.user.count(), 35);
    assert.equal(await prisma.evaluation.count(), 42);
    assert.equal(await prisma.criterionScore.count(), 336);
    assert.equal(await prisma.evaluation.count({ where: { status: "FINALIZED" } }), 9);
    assert.equal(await prisma.evaluation.count({ where: { status: "SUPPLEMENT_REQUESTED" } }), 5);
    assert.equal(await prisma.evaluation.count({ where: { status: "SUPPLEMENT_SUBMITTED" } }), 5);
    assert.equal(await prisma.evaluation.count({ where: { status: "SUPPLEMENT_EXPIRED" } }), 4);
    assert.equal((await prisma.evaluation.groupBy({ by: ["finalRating"], where: { status: "FINALIZED" } })).length, 4);
    assert.equal(await prisma.evaluation.count({ where: { status: { not: "DRAFT" }, submittedAt: null } }), 0);

    // Lịch và phase sau commit phải là snapshot lịch sử, không được để cửa sổ SELF_EVAL tạm trong DB
    const periods = await prisma.evaluationPeriod.findMany({ orderBy: { year: "asc" } });
    assert.deepEqual(periods.map((period) => period.phase), ["CLOSED", "FIRST_REVIEW"]);
    assert.deepEqual(periods.map((period) => period.selfEvalStart?.toISOString()), ["2025-01-15T00:00:00.000Z", "2026-01-15T00:00:00.000Z"]);
    assert.deepEqual(periods.map((period) => period.selfEvalDeadline?.toISOString()), ["2025-03-15T23:59:59.000Z", "2026-03-15T23:59:59.000Z"]);
    assert.equal(periods[0].finalizedAt?.toISOString(), "2025-04-30T10:00:00.000Z");
    const credentials = await readFile(credentialsFile, "utf8");
    assert.equal((JSON.parse(credentials) as unknown[]).length, 35);

    // Mô phỏng một nội dung đã được người dùng chỉnh để phát hiện seed âm thầm viết lại fixture đã có
    const existingScore = await prisma.criterionScore.findFirstOrThrow({ where: { evaluation: { status: "PENDING_REVIEW" } }, orderBy: { id: "asc" } });
    await prisma.criterionScore.update({ where: { id: existingScore.id }, data: { adminComment: "Nội dung đã chỉnh cần giữ nguyên khi seed chạy lại" } });
    const before = await snapshot();
    assert.match((await seed()).stdout, /Đã tạo dữ liệu mẫu/u);
    assert.equal(await snapshot(), before, "Chạy lại seed phải giữ nguyên hồ sơ, dữ liệu con và credential");
    assert.equal(digest(await readFile(credentialsFile, "utf8")), digest(credentials), "Không được ghi lại tệp mật khẩu khi không cấp credential mới");

    // Trigger VC09 vẫn phải chặn nộp thật ngoài cửa sổ sau khi seed kết thúc, không bỏ guard để làm CI xanh
    const draft = await prisma.evaluation.findFirstOrThrow({ where: { status: "DRAFT" } });
    await assert.rejects(prisma.evaluation.update({ where: { id: draft.id }, data: { status: "PENDING_REVIEW", submittedAt: new Date() } }), "Cần giữ nguyên chặn nộp ngoài lịch sau seed");
    assert.equal((await prisma.evaluation.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");
  } finally {
    // Chỉ dọn đúng tệp credential và thư mục tạm do test tạo, không xóa DB hoặc đụng lịch sử append-only
    await prisma.$disconnect();
    await rm(credentialsFile, { force: true });
    await rm(cleanupTarget, { recursive: true, force: true });
  }
});
