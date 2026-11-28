import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import bcrypt from "bcryptjs";
import { JwtService } from "@nestjs/jwt";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../dist/generated/prisma/client.js";

// Chỉ DB local riêng, không đọc DATABASE_URL hoặc .env của ứng dụng đang dùng.
const url = new URL(process.env.LOAD_TEST_DATABASE_URL ?? "http://missing");
assert.ok(process.env.NODE_ENV === "test" && ["localhost", "127.0.0.1"].includes(url.hostname)
  && ["postgres:", "postgresql:"].includes(url.protocol) && url.pathname === "/seminar_load_test", "Cần NODE_ENV=test và LOAD_TEST_DATABASE_URL trỏ DB local seminar_load_test riêng");
const file = fileURLToPath(new URL("../.tmp/load-test/users.json", import.meta.url));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href, options: "-c timezone=UTC" }) });

try {
  if (process.argv.includes("--verify")) {
    const fixture = JSON.parse(await readFile(file, "utf8"));
    const scores = await db.criterionScore.findMany({ where: { criterionId: fixture.criterionId }, include: { evaluation: { select: { unitId: true, status: true } } } });
    const valid = scores.filter((score) => score.evaluation.status === "DRAFT" && score.selfScore?.gte(1) && score.selfScore?.lte(60)
      && score.selfNote?.startsWith(`LOAD:${fixture.runId}:${score.evaluation.unitId}:`));
    const passed = scores.length === fixture.units.length && valid.length === fixture.units.length;
    const result = { checkedAt: new Date().toISOString(), expectedUsers: fixture.units.length, savedCorrectly: valid.length, passed };
    await writeFile(new URL("../.tmp/load-test/integrity.json", import.meta.url), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!passed) process.exitCode = 1;
  } else {
    const count = Number(process.env.LOAD_TEST_USERS ?? 1000);
    assert.ok(Number.isInteger(count) && count >= 1 && count <= 1000, "LOAD_TEST_USERS phải từ 1 đến 1000");
    assert.ok((process.env.JWT_SECRET?.length ?? 0) >= 32, "Cần JWT_SECRET test riêng giống backend kiểm tải");
    const baseUrl = process.env.LOAD_TEST_BASE_URL ?? "http://127.0.0.1:3001";
    const base = new URL(baseUrl);
    assert.ok(["127.0.0.1", "localhost"].includes(base.hostname) && ["http:", "https:"].includes(base.protocol) && base.origin === baseUrl, "LOAD_TEST_BASE_URL phải là origin local của backend test");
    let exists = true;
    try { await access(file); } catch (error) { if (error.code === "ENOENT") exists = false; else throw error; }
    assert.ok(!exists, "Fixture đã tồn tại; dùng DB mới và lưu riêng kết quả lượt cũ trước khi tạo lại");
    assert.equal(await db.user.count(), 0, "Từ chối seed DB đã có tài khoản");
    assert.equal(await db.unit.count(), 0, "Từ chối seed DB đã có đơn vị");
    assert.equal(await db.evaluationPeriod.count(), 0, "Từ chối seed DB đã có kỳ");
    const now = new Date(); const runId = randomUUID(); const adminId = randomUUID();
    const periodId = randomUUID(); const parentId = randomUUID(); const criterionId = randomUUID(); const secondId = randomUUID();
    // Hash dùng cost runtime; bài đo này bắt đầu từ phiên đã xác thực, không đo login/bcrypt.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
    const jwt = new JwtService({ secret: process.env.JWT_SECRET, signOptions: { algorithm: "HS256", issuer: process.env.JWT_ISSUER ?? "seminar", audience: process.env.JWT_AUDIENCE ?? "seminar-client", expiresIn: "2h" } });
    const units = Array.from({ length: count }, (_, index) => ({ unitId: randomUUID(), userId: randomUUID(), evaluationId: randomUUID(), index }));
    await db.$transaction(async (tx) => {
      await tx.user.create({ data: { id: adminId, username: `load-admin-${runId}`, fullName: "Admin kiểm tải", passwordHash, role: "ADMIN", mustChangePassword: false, createdAt: now, updatedAt: now } });
      await tx.evaluationPeriod.create({ data: { id: periodId, year: 2099, name: `Kiểm tải ${runId}`, phase: "SELF_EVAL", maxTotalScore: 100, selfEvalStart: new Date(+now - 60_000), selfEvalDeadline: new Date(+now + 2 * 3_600_000), publishedAt: now, createdById: adminId, createdAt: now, updatedAt: now } });
      await tx.criterion.createMany({ data: [{ id: parentId, parentId: null, maxScore: 100 }, { id: criterionId, parentId, maxScore: 60 }, { id: secondId, parentId, maxScore: 40 }].map((item, index) => ({ ...item, periodId, code: `C${index}`, name: `Tiêu chí ${index}`, sortOrder: index, evidenceRequired: false, createdAt: now, updatedAt: now })) });
      await tx.ratingThreshold.createMany({ data: [{ rating: "EXCELLENT", minPercent: 85, minExclusive: true }, { rating: "GOOD", minPercent: 65 }, { rating: "PASS", minPercent: 50 }, { rating: "FAIL", minPercent: 0 }].map((item) => ({ ...item, id: randomUUID(), periodId, label: item.rating })) });
      for (let offset = 0; offset < count; offset += 100) {
        const batch = units.slice(offset, offset + 100);
        await tx.unit.createMany({ data: batch.map((unit) => ({ id: unit.unitId, code: `LOAD-${unit.index}`, name: `Đơn vị kiểm tải ${unit.index}`, createdAt: now, updatedAt: now })) });
        await tx.user.createMany({ data: batch.map((unit) => ({ id: unit.userId, unitId: unit.unitId, username: `load-unit-${unit.index}`, fullName: `Người dùng ${unit.index}`, passwordHash, role: "UNIT", mustChangePassword: false, createdAt: now, updatedAt: now })) });
        await tx.evaluation.createMany({ data: batch.map((unit) => ({ id: unit.evaluationId, periodId, unitId: unit.unitId, status: "DRAFT", createdAt: now, updatedAt: now })) });
        await tx.criterionScore.createMany({ data: batch.flatMap((unit) => [criterionId, secondId].map((leafId) => ({ id: randomUUID(), evaluationId: unit.evaluationId, criterionId: leafId, createdAt: now, updatedAt: now }))) });
      }
    }, { timeout: 120_000 });
    const fixture = { runId, baseUrl, createdAt: now.toISOString(), expiresAt: new Date(+now + 2 * 3_600_000).toISOString(), periodId, criterionId,
      units: units.map((unit) => ({ ...unit, token: jwt.sign({ sub: unit.userId, tokenUse: "access", ver: 0 }) })) };
    await mkdir(new URL("../.tmp/load-test/", import.meta.url), { recursive: true });
    await writeFile(file, JSON.stringify(fixture), { flag: "wx", mode: 0o600 });
    process.stdout.write(`Đã tạo ${count} danh tính test và fixture private. Phiên/hạn dùng trong hai giờ; không có provider ngoài.\n`);
  }
} finally {
  await db.$disconnect();
}
