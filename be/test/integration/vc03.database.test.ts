import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { ArgumentsHost } from "@nestjs/common";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";

const databaseUrl = process.env.VC03_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Cần chỉ định URL PostgreSQL riêng để kiểm thử VC03");

/** Kiểm tra ràng buộc mới bằng Prisma và PostgreSQL thật trên cơ sở dữ liệu dùng riêng cho thử nghiệm
 * Đầu vào là VC03_TEST_DATABASE_URL trỏ tới DB đã migrate; đầu ra là kết quả đạt/trượt của các assertion
 * Fixture chỉ được thêm mới với UUID ngẫu nhiên, không xóa lịch sử append-only và không gọi dịch vụ ngoài
 * Kiểm múi giờ UTC, điểm sai, tiêu chí cha, cửa sổ bổ sung, dấu nội dung thay đổi/không đổi, lịch sử và lease
 * Nhánh vi phạm phải bị DB từ chối và filter chỉ trả mã/lời báo tiếng Việt, không lộ lỗi SQL hoặc Prisma
 */
test("ràng buộc PostgreSQL VC03 trên cơ sở dữ liệu riêng", async () => {
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const now = new Date();
  const id = () => randomUUID();
  try {
    const database = await prisma.$queryRaw<Array<{ database_name: string; zone: string }>>`
      SELECT current_database() AS database_name, current_setting('TimeZone') AS zone
    `;
    assert.match(database[0].database_name, /vc03_test/);
    assert.equal(database[0].zone, "UTC");

    const adminId = id();
    const unitId = id();
    const periodId = id();
    const evaluationId = id();
    const criterionId = id();
    const scoreId = id();
    const admin = await prisma.user.create({
      data: { id: adminId, username: `vc03-${id()}`, passwordHash: "hash-test", fullName: "Quản trị kiểm thử", role: "ADMIN", createdAt: now, updatedAt: now },
    });
    await prisma.unit.create({ data: { id: unitId, code: `VC03-${id()}`, name: "Đơn vị kiểm thử", createdAt: now, updatedAt: now } });
    await prisma.evaluationPeriod.create({
      data: {
        id: periodId, year: 1000 + Number.parseInt(id().slice(0, 8), 16) % 1_000_000_000, name: "Kỳ kiểm thử VC03", phase: "SELF_EVAL",
        maxTotalScore: 300, selfEvalStart: new Date(now.getTime() - 60_000), selfEvalDeadline: new Date(now.getTime() + 3_600_000),
        publishedAt: new Date(now.getTime() - 120_000), supplementHours: 48, createdById: admin.id, createdAt: now, updatedAt: now,
      },
    });
    // Kiểm unique từng đơn vị và năm bằng dữ liệu thật, đồng thời cho phép nhiều Admin có unitId NULL
    const unitUser = { passwordHash: "hash-test", fullName: "Tài khoản kiểm thử", role: "UNIT", unitId, createdAt: now, updatedAt: now };
    await prisma.user.create({ data: { id: id(), username: `vc03-${id()}`, ...unitUser } });
    await assert.rejects(prisma.user.create({ data: { id: id(), username: `vc03-${id()}`, ...unitUser } }));
    await prisma.user.create({ data: { id: id(), username: `vc03-${id()}`, passwordHash: "hash-test", fullName: "Quản trị thứ hai", role: "ADMIN", createdAt: now, updatedAt: now } });
    const period = await prisma.evaluationPeriod.findUniqueOrThrow({ where: { id: periodId } });
    await assert.rejects(prisma.evaluationPeriod.create({ data: { id: id(), year: period.year, name: "Năm trùng", createdById: adminId, createdAt: now, updatedAt: now } }));
    await assert.rejects(prisma.user.create({ data: { id: id(), username: `vc03-${id()}`, passwordHash: "hash-test", fullName: "Sai vai trò", role: "UNIT", unitId: null, createdAt: now, updatedAt: now } }));
    await assert.rejects(prisma.unit.delete({ where: { id: unitId } }));
    // Kiểm catalog DB để phát hiện FK thực tế có hành vi xóa khác NO ACTION và các CHECK chưa được xác thực
    const foreignKeys = await prisma.$queryRaw<Array<{ name: string }>>`SELECT conname AS name FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND confdeltype <> 'a'`;
    assert.deepEqual(foreignKeys, []);
    const invalidChecks = await prisma.$queryRaw<Array<{ name: string }>>`SELECT conname AS name FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace AND NOT convalidated`;
    assert.deepEqual(invalidChecks, []);
    await prisma.criterion.create({
      data: { id: criterionId, periodId, code: "VC03-LEAF", name: "Tiêu chí lá kiểm thử", maxScore: 10, sortOrder: 1, createdAt: now, updatedAt: now },
    });
    await prisma.evaluation.create({ data: { id: evaluationId, periodId, unitId, status: "DRAFT", createdAt: now, updatedAt: now } });
    const score = await prisma.criterionScore.create({
      data: { id: scoreId, evaluationId, criterionId, selfScore: 2, createdAt: now, updatedAt: now },
    });
    assert.equal(score.selfScore?.toString(), "2");
    let modelRuleError: unknown;
    try {
      await prisma.criterionScore.update({ where: { id: scoreId }, data: { selfScore: 11 } });
    } catch (error) {
      modelRuleError = error;
    }
    assert.ok(modelRuleError, "Cơ sở dữ liệu phải từ chối điểm vượt mức tối đa");
    let publicError: unknown;
    const response = { status: (statusCode: number) => ({ json: (body: unknown) => { publicError = { statusCode, body }; } }) };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(modelRuleError, host);
    assert.equal((publicError as { statusCode: number }).statusCode, 422);
    assert.deepEqual((publicError as { body: { statusCode: number; code: string; message: string; details: unknown[] } }).body, {
      statusCode: 422, code: "DB_RULE_VIOLATION", message: "Quy tắc dữ liệu không cho phép thao tác này.", details: [],
    });
    assert.doesNotMatch(JSON.stringify(publicError), /Prisma|constraint|criterion_scores|SELECT|UPDATE/);

    const parentId = id();
    const childId = id();
    await prisma.criterion.create({ data: { id: parentId, periodId, code: `VC03-P-${id()}`, name: "Tiêu chí cha kiểm thử", maxScore: 10, sortOrder: 2, createdAt: now, updatedAt: now } });
    await prisma.criterion.create({ data: { id: childId, periodId, parentId, code: `VC03-C-${id()}`, name: "Tiêu chí con kiểm thử", maxScore: 10, sortOrder: 3, createdAt: now, updatedAt: now } });
    const parentEvaluationId = id();
    const parentUnitId = id();
    await prisma.unit.create({ data: { id: parentUnitId, code: `VC03-${id()}`, name: "Đơn vị tiêu chí cha", createdAt: now, updatedAt: now } });
    await prisma.evaluation.create({ data: { id: parentEvaluationId, periodId, unitId: parentUnitId, status: "DRAFT", createdAt: now, updatedAt: now } });
    await assert.rejects(
      prisma.criterionScore.create({ data: { id: id(), evaluationId: parentEvaluationId, criterionId: parentId, createdAt: now, updatedAt: now } }),
      "Cơ sở dữ liệu phải từ chối chấm tiêu chí cha",
    );

    const supplementEvaluationId = id();
    const supplementUnitId = id();
    const supplementScoreId = id();
    const supplementStart = new Date(now.getTime() - 60_000);
    const supplementDeadline = new Date(now.getTime() + 3_600_000);
    await prisma.unit.create({ data: { id: supplementUnitId, code: `VC03-${id()}`, name: "Đơn vị bổ sung kiểm thử", createdAt: now, updatedAt: now } });
    await prisma.evaluation.create({
      data: {
        id: supplementEvaluationId, periodId, unitId: supplementUnitId, status: "SUPPLEMENT_REQUESTED",
        supplementRequestedAt: now, supplementStartAt: supplementStart, supplementDeadline, createdAt: now, updatedAt: now,
      },
    });
    await prisma.criterionScore.create({
      data: { id: supplementScoreId, evaluationId: supplementEvaluationId, criterionId, selfScore: 1, needsSupplement: true, createdAt: now, updatedAt: now },
    });
    const changedScore = await prisma.criterionScore.update({ where: { id: supplementScoreId }, data: { selfNote: "Nội dung bổ sung kiểm thử", updatedAt: now } });
    assert.ok(changedScore.supplementedAt, "Nội dung bổ sung thực sự thay đổi phải có mốc thời gian riêng");
    const firstSupplementedAt = changedScore.supplementedAt;
    const evidenceId = id();
    // Trigger VC10 yêu cầu minh chứng bổ sung thuộc giai đoạn thẩm định hoặc bổ sung
    // Fixture vẫn ở SELF_EVAL để kiểm DB từ chối đúng lý do trước khi chuyển sang FIRST_REVIEW
    const supplementEvidence = { id: evidenceId, criterionScoreId: supplementScoreId, uploaderId: admin.id, kind: "LINK", round: "SUPPLEMENT", externalUrl: "https://example.test/minh-chung", description: "Minh chứng bổ sung", createdAt: now };
    await assert.rejects(prisma.evidence.create({ data: supplementEvidence }), /Giai đoạn kỳ không cho phép chỉnh sửa minh chứng/);
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { phase: "FIRST_REVIEW", updatedAt: now } });
    // Sau khi fixture vào đúng giai đoạn, kiểm tiếp trigger VC03 đánh dấu thay đổi thực sự
    await prisma.evidence.create({ data: supplementEvidence });
    const markedByEvidence = await prisma.criterionScore.findUniqueOrThrow({ where: { id: supplementScoreId } });
    assert.ok(markedByEvidence.supplementedAt && markedByEvidence.supplementedAt >= firstSupplementedAt);
    await prisma.evidence.update({ where: { id: evidenceId }, data: { description: "Minh chứng bổ sung" } });
    const unchangedEvidence = await prisma.criterionScore.findUniqueOrThrow({ where: { id: supplementScoreId } });
    assert.equal(unchangedEvidence.supplementedAt?.toISOString(), markedByEvidence.supplementedAt?.toISOString(), "Cập nhật lặp cùng nội dung không được tạo dấu bổ sung mới");
    // PostgreSQL lưu micro giây nhưng Date của JavaScript chỉ giữ mili giây
    // Chờ qua độ phân giải đó để kiểm mốc mới không chập hai thời điểm hợp lệ thành một
    await prisma.$queryRaw`SELECT pg_sleep(0.005)::text`;
    await prisma.evidence.update({ where: { id: evidenceId }, data: { description: "Nội dung minh chứng đã cập nhật" } });
    const changedEvidence = await prisma.criterionScore.findUniqueOrThrow({ where: { id: supplementScoreId } });
    assert.ok(changedEvidence.supplementedAt && changedEvidence.supplementedAt > unchangedEvidence.supplementedAt!);

    await prisma.evaluation.update({ where: { id: supplementEvaluationId }, data: { supplementDeadline: new Date(now.getTime() - 1) } });
    await assert.rejects(
      prisma.criterionScore.update({ where: { id: supplementScoreId }, data: { selfNote: "Không được sửa sau hạn" } }),
      "Cơ sở dữ liệu phải khóa nội dung ngay sau hạn bổ sung",
    );
    await assert.rejects(
      prisma.evaluation.update({ where: { id: supplementEvaluationId }, data: { supplementStartAt: supplementDeadline } }),
      "Cơ sở dữ liệu phải từ chối mốc mở bằng hoặc sau hạn bổ sung",
    );

    const historyId = id();
    await prisma.statusHistory.create({ data: { id: historyId, evaluationId, actorId: null, fromStatus: "DRAFT", toStatus: "PENDING_REVIEW", createdAt: now } });
    await assert.rejects(
      prisma.statusHistory.update({ where: { id: historyId }, data: { comment: "Không được sửa lịch sử" } }),
      "Cơ sở dữ liệu phải giữ lịch sử trạng thái ở chế độ chỉ được thêm",
    );

    const notification = await prisma.notification.create({
      data: { id: id(), userId: admin.id, type: "VC03_TEST", title: "Thông báo kiểm thử", body: "Nội dung kiểm thử", createdAt: now },
    });
    await assert.rejects(
      prisma.notificationDelivery.create({ data: { id: id(), notificationId: notification.id, channel: "EMAIL", claimedAt: now, createdAt: now, updatedAt: now } }),
      "Cơ sở dữ liệu phải yêu cầu lease có đủ mốc và token claim",
    );
  } finally {
    await prisma.$disconnect();
  }
});
