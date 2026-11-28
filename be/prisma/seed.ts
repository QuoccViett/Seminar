import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import bcrypt from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { seedAssets } from "./seed-assets.js";
import { captureSupplementBaseline } from "../src/modules/evaluations/review-policy.js";


if (process.env.SEED_DEMO_ENABLED !== "true" || process.env.NODE_ENV === "production") throw new Error("Seed demo chỉ chạy khi SEED_DEMO_ENABLED=true ngoài production");
if (process.env.STORAGE_PROVIDER === "supabase") throw new Error("Seed demo minh chứng chỉ dùng kho local riêng; không ghi bucket thật");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Cần cấu hình DATABASE_URL trước khi tạo dữ liệu mẫu");
}

const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!adminPassword) {
  throw new Error("Cần cấu hình SEED_ADMIN_PASSWORD trước khi tạo quản trị viên mẫu");
}
const seedAdminPassword: string = adminPassword;

const credentialsFile = process.env.SEED_CREDENTIALS_FILE;
const rotatePasswords = process.env.SEED_ROTATE_PASSWORDS === "true";
const adminUsername = process.env.SEED_ADMIN_USERNAME ?? "admin";
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@seminar.local";
// Seed dùng phiên UTC giống PrismaService để timestamp lịch sử và trigger có cùng hệ quy chiếu
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: "-c timezone=UTC" }) });
const now = new Date();
const statusLabels: Record<string, string> = { DRAFT: "Đang tự chấm", SUBMITTED: "Đã nộp hồ sơ", IN_REVIEW: "Đang thẩm định", PENDING_REVIEW: "Chờ duyệt", NEEDS_SUPPLEMENT: "Được yêu cầu bổ sung", SUPPLEMENT_REQUESTED: "Được yêu cầu bổ sung", SUPPLEMENT_SUBMITTED: "Đã nộp bổ sung", SUPPLEMENT_EXPIRED: "Đã hết hạn bổ sung", FINALIZED: "Đã chốt" };

const uuid = (number: number): string =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

const units = Array.from({ length: 34 }, (_, index) => {
  const number = index + 1;
  const suffix = String(number).padStart(2, "0");
  return {
    id: uuid(101 + index),
    code: `COSO-DEMO-${suffix}`,
    name: `Cơ sở Đoàn demo ${suffix}`,
    username: `coso${suffix}`,
  };
});

const periods = [
  {
    id: uuid(1),
    year: 2026,
    name: "Đợt thi đua năm 2026",
    phase: "FIRST_REVIEW",
    maxTotalScore: 300,
    selfEvalStart: new Date("2026-01-15T00:00:00.000Z"),
    selfEvalDeadline: new Date("2026-03-15T23:59:59.000Z"),
    supplementHours: 48,
    publishedAt: new Date("2026-01-10T08:00:00.000Z"),
    finalizedAt: null,
  },
  {
    id: uuid(2),
    year: 2025,
    name: "Đợt thi đua năm 2025",
    phase: "CLOSED",
    maxTotalScore: 300,
    selfEvalStart: new Date("2025-01-15T00:00:00.000Z"),
    selfEvalDeadline: new Date("2025-03-15T23:59:59.000Z"),
    supplementHours: 48,
    publishedAt: new Date("2025-01-10T08:00:00.000Z"),
    finalizedAt: new Date("2025-04-30T10:00:00.000Z"),
  },
] as const;

const thresholds = [
  { rating: "EXCELLENT", label: "Hoàn thành xuất sắc nhiệm vụ", minPercent: 85, minExclusive: true, color: "#16a34a" },
  { rating: "GOOD", label: "Hoàn thành tốt nhiệm vụ", minPercent: 65, minExclusive: false, color: "#eab308" },
  { rating: "PASS", label: "Hoàn thành nhiệm vụ", minPercent: 50, minExclusive: false, color: "#f97316" },
  { rating: "FAIL", label: "Không hoàn thành nhiệm vụ", minPercent: 0, minExclusive: false, color: "#dc2626" },
] as const;

const criterionDefinitions = [
  { code: "A", name: "Công tác giáo dục chính trị tư tưởng", maxScore: 50, parent: true },
  { code: "A1", name: "Tổ chức học tập nghị quyết, chủ trương", maxScore: 25, parent: false },
  { code: "A2", name: "Tuyên truyền, giáo dục đoàn viên", maxScore: 25, parent: false },
  { code: "B", name: "Tổ chức phong trào hành động cách mạng", maxScore: 100, parent: true },
  { code: "B1", name: "Phong trào tình nguyện vì cộng đồng", maxScore: 50, parent: false },
  { code: "B2", name: "Phong trào sáng tạo và chuyển đổi số", maxScore: 50, parent: false },
  { code: "C", name: "Công tác xây dựng tổ chức Đoàn", maxScore: 75, parent: true },
  { code: "C1", name: "Quản lý đoàn viên và phát triển lực lượng", maxScore: 40, parent: false },
  { code: "C2", name: "Kiểm tra, giám sát và sinh hoạt chi đoàn", maxScore: 35, parent: false },
  { code: "D", name: "Công tác tham mưu, phối hợp", maxScore: 75, parent: true },
  { code: "D1", name: "Tham mưu cấp ủy, chính quyền", maxScore: 40, parent: false },
  { code: "D2", name: "Chế độ thông tin, báo cáo", maxScore: 35, parent: false },
] as const;

type EvaluationStatus = "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "NEEDS_SUPPLEMENT" | "SUPPLEMENT_SUBMITTED" | "SUPPLEMENT_EXPIRED" | "FINALIZED";
type DatabaseEvaluationStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "SUPPLEMENT_REQUESTED"
  | "SUPPLEMENT_SUBMITTED"
  | "SUPPLEMENT_EXPIRED"
  | "FINALIZED";

function databaseStatus(status: EvaluationStatus): DatabaseEvaluationStatus {
  if (status === "SUBMITTED" || status === "IN_REVIEW") return "PENDING_REVIEW";
  if (status === "NEEDS_SUPPLEMENT") return "SUPPLEMENT_REQUESTED";
  return status;
}

function statusFor(index: number, periodYear: number): EvaluationStatus {
  if (periodYear === 2025) return index % 2 === 0 ? "FINALIZED" : "SUBMITTED";
  return ["DRAFT", "SUBMITTED", "IN_REVIEW", "NEEDS_SUPPLEMENT", "FINALIZED", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"][index % 7] as EvaluationStatus;
}

function statusChain(status: EvaluationStatus): EvaluationStatus[] {
  switch (status) {
    case "DRAFT": return ["DRAFT"];
    case "SUBMITTED": return ["DRAFT", "SUBMITTED"];
    case "IN_REVIEW": return ["DRAFT", "SUBMITTED", "IN_REVIEW"];
    case "NEEDS_SUPPLEMENT": return ["DRAFT", "SUBMITTED", "IN_REVIEW", "NEEDS_SUPPLEMENT"];
    case "SUPPLEMENT_SUBMITTED": return ["DRAFT", "SUBMITTED", "IN_REVIEW", "NEEDS_SUPPLEMENT", "SUPPLEMENT_SUBMITTED"];
    case "SUPPLEMENT_EXPIRED": return ["DRAFT", "SUBMITTED", "IN_REVIEW", "NEEDS_SUPPLEMENT", "SUPPLEMENT_EXPIRED"];
    case "FINALIZED": return ["DRAFT", "SUBMITTED", "IN_REVIEW", "FINALIZED"];
  }
}

/** Tạo dữ liệu minh họa trong giao dịch để các bảng liên quan luôn nhất quán
 * Đầu vào là DATABASE_URL cùng cấu hình tài khoản seed; đầu ra là kỳ, đơn vị và hồ sơ mẫu đã ghi trong DB
 * Chỉ hồ sơ chưa tồn tại được dựng từ DRAFT qua lần nộp PENDING_REVIEW, sau đó mới tới trạng thái minh họa
 * Kỳ mở tạm ở SELF_EVAL theo giờ DB để trigger kiểm lần nộp như yêu cầu thật, cuối giao dịch khôi phục lịch và phase mẫu
 * Chạy lại giữ nguyên hồ sơ, điểm, minh chứng và lịch sử đã có, không xóa submittedAt hoặc đặt hồ sơ đã nộp về DRAFT
 * Mật khẩu cũ chỉ thay khi bật tùy chọn xoay vòng, credential mới được lưu vào tệp riêng sau khi commit
 * Nếu bất kỳ ghi nhận nào thất bại, giao dịch rollback để không lưu lịch tạm hoặc dữ liệu nửa chừng
 * Không chạy trên DB dùng chung khi chưa chỉ định đích seed an toàn, lỗi DB được xử lý tại biên script
 */
async function main(): Promise<void> {
  const assets = await seedAssets();
  const generatedCredentials: { username: string; password: string }[] = [];
  const existingUsers = await prisma.user.findMany({
    where: { username: { in: [adminUsername, ...units.map((unit) => unit.username)] } },
    select: { username: true },
  });
  const existingUsernames = new Set(existingUsers.map((user) => user.username));

  if ((!credentialsFile && (rotatePasswords || existingUsernames.size < units.length + 1))) {
    throw new Error(
      "Cần cấu hình SEED_CREDENTIALS_FILE an toàn trước khi tạo hoặc đổi mật khẩu tài khoản mẫu",
    );
  }

  await prisma.$transaction(async (tx) => {
    const adminHash = await bcrypt.hash(seedAdminPassword, 12);
    const admin = await tx.user.upsert({
      where: { username: adminUsername },
      update: {
        email: adminEmail,
        fullName: "Quản trị viên Ban Thanh niên CATP",
        role: "ADMIN",
        isActive: true,
        ...(rotatePasswords ? { passwordHash: adminHash, mustChangePassword: true } : {}),
      },
      create: {
        id: uuid(10),
        username: adminUsername,
        email: adminEmail,
        passwordHash: adminHash,
        mustChangePassword: true,
        fullName: "Quản trị viên Ban Thanh niên CATP",
        role: "ADMIN",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (!existingUsernames.has(adminUsername) || rotatePasswords) {
      generatedCredentials.push({ username: adminUsername, password: seedAdminPassword });
    }

    const unitUsers: { unitId: string; userId: string; username: string }[] = [];
    for (const [index, unitSeed] of units.entries()) {
      await tx.unit.upsert({
        where: { code: unitSeed.code },
        update: { name: unitSeed.name, unitType: "DON_VI_TRUC_THUOC", sortOrder: index + 1, isActive: true, updatedAt: now },
        create: { id: unitSeed.id, code: unitSeed.code, name: unitSeed.name, unitType: "DON_VI_TRUC_THUOC", sortOrder: index + 1, isActive: true, createdAt: now, updatedAt: now },
      });

      const existing = await tx.user.findUnique({
        where: { username: unitSeed.username },
        select: { id: true },
      });
      const password = !existing || rotatePasswords ? (process.env.INITIAL_ACCOUNT_PASSWORD ?? "123456") : null;
      const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
      const createPasswordHash = passwordHash ?? "";
      const user = await tx.user.upsert({
        where: { username: unitSeed.username },
        update: {
          fullName: `Tài khoản ${unitSeed.name}`,
          role: "UNIT",
          unitId: unitSeed.id,
          isActive: true,
          ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
        },
        create: {
          id: uuid(301 + index),
          username: unitSeed.username,
          passwordHash: createPasswordHash,
          mustChangePassword: true,
          fullName: `Tài khoản ${unitSeed.name}`,
          role: "UNIT",
          unitId: unitSeed.id,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      });
      if (password) generatedCredentials.push({ username: unitSeed.username, password });
      unitUsers.push({ unitId: unitSeed.id, userId: user.id, username: unitSeed.username });
    }

    for (const periodSeed of periods) {
      // Không thay lịch, ngưỡng hoặc điểm của kỳ đã tồn tại khi chạy lại seed
      if (await tx.evaluationPeriod.findUnique({ where: { year: periodSeed.year }, select: { id: true } })) continue;
      // Đọc giờ statement sau bước tạo tài khoản để thời gian băm mật khẩu không làm hết cửa sổ trước khi dựng hồ sơ
      // Cửa sổ dài bằng ngân sách giao dịch, chỉ tồn tại trong giao dịch và không vô hiệu hóa bất kỳ trigger nào
      const [databaseClock] = await tx.$queryRaw<{ now: Date }[]>`SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now`;
      const seedWindowStart = new Date(databaseClock.now.getTime() - 60_000);
      const seedWindowDeadline = new Date(databaseClock.now.getTime() + 120_000);
      const seedPublishedAt = new Date(databaseClock.now.getTime() - 120_000);
      const originalSchedule = {
        phase: periodSeed.phase,
        selfEvalStart: periodSeed.selfEvalStart,
        selfEvalDeadline: periodSeed.selfEvalDeadline,
        publishedAt: periodSeed.publishedAt,
        finalizedAt: periodSeed.finalizedAt,
      };
      const period = await tx.evaluationPeriod.upsert({
        where: { year: periodSeed.year },
        update: { name: periodSeed.name, phase: "SELF_EVAL", maxTotalScore: periodSeed.maxTotalScore, selfEvalStart: seedWindowStart, selfEvalDeadline: seedWindowDeadline, supplementHours: periodSeed.supplementHours, publishedAt: seedPublishedAt, finalizedAt: null, updatedAt: now },
        create: { ...periodSeed, phase: "SELF_EVAL", selfEvalStart: seedWindowStart, selfEvalDeadline: seedWindowDeadline, publishedAt: seedPublishedAt, finalizedAt: null, createdById: admin.id, createdAt: now, updatedAt: now },
      });

      for (const [index, threshold] of thresholds.entries()) {
        await tx.ratingThreshold.upsert({
          where: { periodId_rating: { periodId: period.id, rating: threshold.rating } },
          update: threshold,
          create: { id: uuid(1000 + (periodSeed.year - 2025) * 10 + index), periodId: period.id, ...threshold },
        });
      }

      const parentIds = new Map<string, string>();
      for (const [index, definition] of criterionDefinitions.entries()) {
        const parentCode = definition.code.length > 1 ? definition.code[0] : null;
        const criterion = await tx.criterion.upsert({
          where: { periodId_code: { periodId: period.id, code: definition.code } },
          update: { name: definition.name, maxScore: definition.maxScore, parentId: parentCode ? parentIds.get(parentCode) : null, sortOrder: index + 1, updatedAt: now },
          create: { id: uuid(1100 + (periodSeed.year - 2025) * 100 + index), periodId: period.id, parentId: parentCode ? parentIds.get(parentCode) : null, code: definition.code, name: definition.name, description: `Minh chứng cho tiêu chí ${definition.code}.`, maxScore: definition.maxScore, evidenceRequirement: "Tối thiểu một minh chứng phù hợp.", allowText: true, allowFile: true, allowLink: true, evidenceRequired: !definition.parent, sortOrder: index + 1, createdAt: now, updatedAt: now },
        });
        if (definition.parent) parentIds.set(definition.code, criterion.id);
      }

      const criteria = await tx.criterion.findMany({ where: { periodId: period.id }, orderBy: { sortOrder: "asc" } });
      const evaluationCount = periodSeed.year === 2026 ? unitUsers.length : 8;
      for (let index = 0; index < evaluationCount; index += 1) {
        const unitUser = unitUsers[index];
        // Không dựng lại hồ sơ đã có vì reset submittedAt vừa vi phạm trigger vừa làm mất nội dung người dùng đã chỉnh
        // Bỏ qua toàn bộ phần con của hồ sơ để chạy lại seed không thay điểm, minh chứng hoặc ghi thêm history/audit
        const existingEvaluation = await tx.evaluation.findUnique({
          where: { periodId_unitId: { periodId: period.id, unitId: unitUser.unitId } },
          select: { id: true },
        });
        if (existingEvaluation) continue;
        const status = statusFor(index, periodSeed.year);
        const evaluationId = uuid(2000 + (periodSeed.year - 2025) * 100 + index);
        const submittedAt = status === "DRAFT" ? null : new Date(periodSeed.year, 1, 10 + index);
        const supplemental = ["NEEDS_SUPPLEMENT", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"].includes(status);
        const inReview = status === "IN_REVIEW" || supplemental || status === "FINALIZED";
        const finalized = status === "FINALIZED";
        const ratio = finalized ? [0.3, 0.55, 0.75, 0.95][index % 4] : (0.55 + (index % 4) * 0.1);
        const evaluation = await tx.evaluation.create({
          data: { id: evaluationId, periodId: period.id, unitId: unitUser.unitId, status: "DRAFT", createdAt: now, updatedAt: now },
        });

        const leafCriteria = criteria.filter((criterion) => criterion.parentId !== null);
        for (const [criterionIndex, criterion] of leafCriteria.entries()) {
          const scoreId = uuid(4000 + (periodSeed.year - 2025) * 1000 + index * 20 + criterionIndex);
          const seededSelfScore = Math.round(Number(criterion.maxScore) * ratio * 100) / 100;
          const score = await tx.criterionScore.upsert({
            where: { evaluationId_criterionId: { evaluationId: evaluation.id, criterionId: criterion.id } },
            update: { selfScore: status === "DRAFT" ? null : seededSelfScore, selfNote: status === "DRAFT" ? null : `Tự đánh giá của ${unitUser.username}.`, adminScore: null, adminComment: null, needsSupplement: false, supplementNote: null, reviewedById: null, reviewedAt: null, updatedAt: now },
            create: { id: scoreId, evaluationId: evaluation.id, criterionId: criterion.id, selfScore: status === "DRAFT" ? null : seededSelfScore, selfNote: status === "DRAFT" ? null : `Tự đánh giá của ${unitUser.username}.`, adminScore: null, adminComment: null, needsSupplement: false, supplementNote: null, reviewedById: null, reviewedAt: null, createdAt: now, updatedAt: now },
          });

          if (status !== "DRAFT") {
            const evidenceId = uuid(6000 + (periodSeed.year - 2025) * 1000 + index * 20 + criterionIndex);
            const asset = assets[criterionIndex % assets.length];
            const storagePath = `final/${evaluation.id}/${evidenceId}`;
            const filePath = resolve(process.env.STORAGE_LOCAL_DIR ?? ".private-storage", storagePath);
            await mkdir(dirname(filePath), { recursive: true }); await writeFile(filePath, asset.bytes, { mode: 0o600 });
            await tx.evidence.create({ data: { id: evidenceId, criterionScoreId: score.id, uploaderId: unitUser.userId, kind: "FILE", round: "INITIAL", fileName: `minh-chung-demo.${asset.extension}`, mimeType: asset.mime, sizeBytes: BigInt(asset.bytes.length), storagePath, description: "Minh chứng do nhóm tự tạo phục vụ diễn tập", previewStatus: asset.extension === "docx" ? "NOT_REQUIRED" : "READY", createdAt: now } });
          }
        }

        const dbEvaluationStatus = databaseStatus(status);
        for (const [criterionIndex, criterion] of leafCriteria.entries()) {
          const criterionSelfScore = Math.round(Number(criterion.maxScore) * ratio * 100) / 100;
          const adminScore = inReview && status !== "IN_REVIEW" ? criterionSelfScore : null;
          await tx.criterionScore.update({
            where: { evaluationId_criterionId: { evaluationId: evaluation.id, criterionId: criterion.id } },
            data: {
              selfScore: status === "DRAFT" ? null : criterionSelfScore,
              adminScore,
              adminComment: adminScore ? "Đã kiểm tra minh chứng." : null,
              needsSupplement: supplemental && criterionIndex % 2 === 0,
              supplementNote: supplemental && criterionIndex % 2 === 0 ? "Bổ sung tài liệu còn thiếu." : null,
              reviewedById: inReview ? admin.id : null,
              reviewedAt: inReview ? new Date(periodSeed.year, 1, 18 + index) : null,
              updatedAt: now,
            },
          });
        }

        // Lần đầu gán submittedAt phải là DRAFT → PENDING_REVIEW trong kỳ SELF_EVAL đang mở
        // Những hồ sơ minh họa bổ sung/chốt đi tiếp bằng UPDATE sau, giữ nguyên submittedAt để không giả thành lần nộp mới
        // Timestamp nộp lịch sử vẫn lấy từ bộ dữ liệu mẫu, còn điều kiện được phép ghi do statement time hiện tại quyết định
        if (submittedAt) await tx.evaluation.update({
          where: { id: evaluation.id }, data: { status: "PENDING_REVIEW", submittedAt, updatedAt: now },
        });

        const requestedAt = new Date(Date.now() - 120_000);
        const supplementStartAt = new Date(Date.now() - 60_000);
        const supplementDeadline = new Date(Date.now() + 90 * 60_000);
        if (supplemental) {
          await tx.evaluationPeriod.update({ where: { id: period.id }, data: { phase: "SUPPLEMENT" } });
          const flagged = await tx.criterionScore.findMany({ where: { evaluationId: evaluation.id, needsSupplement: true }, include: { evidences: true } });
          for (const score of flagged) await tx.criterionScore.update({ where: { id: score.id }, data: { supplementBaseline: { ...captureSupplementBaseline(score, requestedAt), source: "SEED" } } });
          await tx.evaluation.update({ where: { id: evaluation.id }, data: { status: "SUPPLEMENT_REQUESTED", firstReviewedAt: requestedAt, supplementRequestedAt: requestedAt, supplementStartAt, supplementDeadline } });
          if (status === "SUPPLEMENT_SUBMITTED") {
            for (const score of flagged) await tx.criterionScore.update({ where: { id: score.id }, data: { selfNote: "Đã bổ sung tài liệu demo", supplementedAt: new Date() } });
            await tx.evaluation.update({ where: { id: evaluation.id }, data: { status: "SUPPLEMENT_SUBMITTED", supplementSubmittedAt: new Date() } });
          } else if (status === "SUPPLEMENT_EXPIRED") {
            await tx.evaluation.update({ where: { id: evaluation.id }, data: { status: "SUPPLEMENT_EXPIRED", supplementDeadline: new Date(Date.now() - 1000) } });
          }
          await tx.evaluationPeriod.update({ where: { id: period.id }, data: { phase: "SELF_EVAL" } });
        } else {
          const [total] = await tx.$queryRaw<{ current_total: { toNumber(): number }; current_percent: { toNumber(): number }; suggested_rating: string }[]>`SELECT current_total, current_percent, suggested_rating FROM v_evaluation_totals WHERE evaluation_id = ${evaluation.id}::uuid`;
          await tx.evaluation.update({ where: { id: evaluation.id }, data: { status: dbEvaluationStatus, firstReviewedAt: inReview ? now : null, finalizedAt: finalized ? now : null, finalizedById: finalized ? admin.id : null, finalScore: finalized ? total.current_total.toNumber() : null, finalPercent: finalized ? total.current_percent.toNumber() : null, finalRating: finalized ? total.suggested_rating : null, updatedAt: now } });
        }

        for (const [historyIndex, toStatus] of statusChain(status).entries()) {
          // status_histories là bảng chỉ-thêm (trigger chặn UPDATE/DELETE): chạy lại seed thì bỏ qua dòng đã có
          await tx.statusHistory.createMany({ data: [{ id: uuid(8000 + (periodSeed.year - 2025) * 1000 + index * 10 + historyIndex), evaluationId: evaluation.id, actorId: historyIndex === 0 ? unitUser.userId : admin.id, fromStatus: historyIndex === 0 ? null : databaseStatus(statusChain(status)[historyIndex - 1]), toStatus: databaseStatus(toStatus), comment: `Chuyển trạng thái mẫu sang ${statusLabels[toStatus] ?? "chưa xác định"}.`, createdAt: new Date(periodSeed.year, 1, 5 + historyIndex + index) }], skipDuplicates: true });
        }

        if (status === "IN_REVIEW" || status === "NEEDS_SUPPLEMENT" || status === "FINALIZED") {
          await tx.evaluationFeedback.upsert({
            where: { id: uuid(9000 + (periodSeed.year - 2025) * 100 + index) },
            update: { content: status === "NEEDS_SUPPLEMENT" ? "Đề nghị đơn vị bổ sung minh chứng cho các tiêu chí được đánh dấu." : "Hồ sơ đã được tiếp nhận và đang xử lý." },
            create: { id: uuid(9000 + (periodSeed.year - 2025) * 100 + index), evaluationId: evaluation.id, authorId: admin.id, type: status === "NEEDS_SUPPLEMENT" ? "SUPPLEMENT_REQUEST" : "GENERAL", content: status === "NEEDS_SUPPLEMENT" ? "Đề nghị đơn vị bổ sung minh chứng cho các tiêu chí được đánh dấu." : "Hồ sơ đã được tiếp nhận và đang xử lý.", createdAt: now },
          });
        }

        await tx.notification.upsert({
          where: { id: uuid(10000 + (periodSeed.year - 2025) * 100 + index) },
          update: { title: `Cập nhật hồ sơ ${periodSeed.year}`, body: `Hồ sơ của ${unitUser.username} đang ở trạng thái ${statusLabels[status] ?? "chưa xác định"}.`, isRead: index % 3 === 0 },
          create: { id: uuid(10000 + (periodSeed.year - 2025) * 100 + index), userId: unitUser.userId, channel: "SYSTEM", type: "EVALUATION_STATUS_CHANGED", title: `Cập nhật hồ sơ ${periodSeed.year}`, body: `Hồ sơ của ${unitUser.username} đang ở trạng thái ${statusLabels[status] ?? "chưa xác định"}.`, refType: "EVALUATION", refId: evaluation.id, isRead: index % 3 === 0, scheduledAt: null, sentAt: null, createdAt: now },
        });

        // audit_logs là bảng chỉ-thêm (trigger chặn UPDATE/DELETE): chạy lại seed thì bỏ qua dòng đã có
        await tx.auditLog.createMany({ data: [{ id: uuid(12000 + (periodSeed.year - 2025) * 100 + index), actorId: status === "DRAFT" ? unitUser.userId : admin.id, action: "SEED_EVALUATION", entity: "Evaluation", entityId: evaluation.id, after: { status, periodYear: periodSeed.year }, ip: "127.0.0.1", createdAt: now }], skipDuplicates: true });

      }

      // Khôi phục lịch, phase và mốc chốt mẫu sau khi mọi hồ sơ mới hoàn chỉnh, không commit kỳ SELF_EVAL tạm
      await tx.evaluationPeriod.update({
        where: { id: period.id },
        data: { ...originalSchedule, updatedAt: now },
      });
    }

  }, { maxWait: 10_000, timeout: 120_000 });

  // Hai kỳ live chỉ tạo khi được yêu cầu, không đổi lịch của lần seed trước
  if (process.env.SEED_LIVE_PERIODS === "true") {
    for (const [position, year] of [2027, 2028].entries()) {
      if (await prisma.evaluationPeriod.findUnique({ where: { year } })) continue;
      const timestamp = new Date(); const admin = await prisma.user.findUniqueOrThrow({ where: { username: adminUsername } });
      await prisma.$transaction(async (tx) => {
        const periodId = uuid(18000 + position);
        await tx.evaluationPeriod.create({ data: { id: periodId, year, name: position === 0 ? "Demo kỳ nháp chưa công bố" : "Demo mở sau hai phút", phase: "SETUP", maxTotalScore: 300, selfEvalStart: new Date(+timestamp + 120000), selfEvalDeadline: new Date(+timestamp + 86400000), publishedAt: position === 1 ? timestamp : null, createdById: admin.id, createdAt: timestamp, updatedAt: timestamp } });
        await tx.ratingThreshold.createMany({ data: thresholds.map((row) => ({ ...row, id: uuid(18100 + position * 10 + thresholds.indexOf(row)), periodId })) });
        const parentIds = new Map<string, string>(); const leaves: string[] = [];
        for (const [index, definition] of criterionDefinitions.entries()) {
          const id = uuid(18200 + position * 100 + index); const parentCode = definition.code.length > 1 ? definition.code[0] : null;
          await tx.criterion.create({ data: { id, periodId, code: definition.code, name: definition.name, maxScore: definition.maxScore, parentId: parentCode ? parentIds.get(parentCode) : null, sortOrder: index, evidenceRequired: false, createdAt: timestamp, updatedAt: timestamp } });
          if (definition.parent) parentIds.set(definition.code, id); else leaves.push(id);
        }
        if (position === 1) for (const [index, unit] of units.entries()) {
          const evaluationId = uuid(19000 + index);
          await tx.evaluation.create({ data: { id: evaluationId, periodId, unitId: unit.id, status: "DRAFT", createdAt: timestamp, updatedAt: timestamp } });
          await tx.criterionScore.createMany({ data: leaves.map((criterionId, leafIndex) => ({ id: uuid(20000 + index * 20 + leafIndex), evaluationId, criterionId, createdAt: timestamp, updatedAt: timestamp })) });
        }
      });
    }
  }

  if (generatedCredentials.length > 0) {
    if (!credentialsFile) throw new Error("Cần cấu hình SEED_CREDENTIALS_FILE để lưu thông tin tài khoản mẫu");
    const filePath = resolve(credentialsFile);
    await writeFile(filePath, `${JSON.stringify(generatedCredentials, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.info("Đã lưu thông tin tài khoản mẫu, cần bảo quản an toàn và xóa sau khi sử dụng");
  }
  console.info(`Đã tạo dữ liệu mẫu cho ${units.length} đơn vị, ${unitUsersCount()} tài khoản; hai kỳ lịch sử${process.env.SEED_LIVE_PERIODS === "true" ? " và hai kỳ live" : ""}`);
}

function unitUsersCount(): number {
  return units.length;
}

// Bắt lỗi tại biên script để không in chi tiết DB hoặc đường dẫn có thể chứa thông tin nhạy cảm
try {
  await main();
} catch (error) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? ` (${error.code})` : "";
  console.error(`Không thể tạo dữ liệu mẫu, vui lòng kiểm tra cấu hình và cơ sở dữ liệu${code}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
