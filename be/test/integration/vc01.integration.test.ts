import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { AuditService } from "../../src/common/services/audit.service.js";
import { AccessService } from "../../src/common/services/access.service.js";
import { ClockService } from "../../src/common/services/clock.service.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";
import type { ArgumentsHost } from "@nestjs/common";
import { Controller, Get, Inject, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

const databaseUrl = process.env.VC01_TEST_DATABASE_URL;
const baseUrl = process.env.VC01_TEST_BASE_URL;
if (!databaseUrl || !baseUrl) throw new Error("Cần chỉ định DB và máy chủ kiểm thử VC01 riêng");

@Controller("quyen-thu")
class AccessTestController {
  constructor(@Inject("ACCESS_TEST") private readonly access: AccessService) {}

  /** Mô phỏng UNIT thiếu đơn vị để kiểm tra phản hồi HTTP của helper trên DB thật */
  @Get()
  check(): Promise<void> { return this.access.assertEvaluationAccess(randomUUID(), "UNIT", null); }
}

/** Kiểm tra Prisma và PostgreSQL thật bằng DB được chỉ định riêng cho thử nghiệm
 * So sánh múi giờ phiên, round-trip timestamp, lưu audit và nhánh từ chối quyền
 * Dữ liệu tạo mới chỉ nằm trong DB tạm, không xóa hoặc thay đổi DB dùng chung
 */
test("PostgreSQL UTC, audit và quyền truy cập", async () => {
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  try {
    const timezone = await prisma.$queryRaw<Array<{ zone: string }>>`SELECT current_setting('TimeZone') AS zone`;
    assert.equal(timezone[0].zone, "UTC");
    const now = new Date("2026-11-17T00:00:00.123Z");
    const unit = await prisma.unit.create({ data: { id: randomUUID(), code: `VC01-${randomUUID()}`, name: "Đơn vị kiểm thử", createdAt: now, updatedAt: now } });
    assert.equal(unit.createdAt.toISOString(), now.toISOString());
    const audit = new AuditService(prisma, new ClockService());
    const entityId = randomUUID();
    await audit.record({ actorId: null, action: "TEST", entity: "VC01", entityId, after: { nested: [{ password: "bi-mat-thu", cookie: "cookie-thu" }] } });
    const saved = await prisma.auditLog.findFirstOrThrow({ where: { entityId } });
    assert.doesNotMatch(JSON.stringify(saved.after), /bi-mat-thu|cookie-thu/);
    await assert.rejects(new AccessService(prisma).assertEvaluationAccess(randomUUID(), "UNIT", null), { status: 404 });

    // Đưa lỗi Prisma thật vào filter và chỉ kiểm dữ liệu công khai, không in lỗi DB thô
    let body: unknown;
    const response = { status: () => ({ json: (value: unknown) => { body = value; } }) };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    try {
      await prisma.unit.create({ data: { id: randomUUID(), code: unit.code, name: "Trùng", createdAt: now, updatedAt: now } });
      assert.fail("Phải từ chối mã đơn vị trùng");
    } catch (error) {
      new AllExceptionsFilter().catch(error, host);
      assert.equal((body as { statusCode: number }).statusCode, 409);
      assert.doesNotMatch(JSON.stringify(body), /Prisma|SELECT|INSERT/);
    }
    try {
      await prisma.$executeRaw`UPDATE units SET unit_type = 'SAI' WHERE id = ${unit.id}::uuid`;
      assert.fail("Phải từ chối loại đơn vị sai");
    } catch (error) {
      new AllExceptionsFilter().catch(error, host);
      assert.equal((body as { statusCode: number }).statusCode, 422);
      assert.doesNotMatch(JSON.stringify(body), /Prisma|UPDATE|unit_type/);
    }
    try {
      await prisma.unit.update({ where: { id: unit.id }, data: { unitType: "SAI" } });
      assert.fail("Phải từ chối loại đơn vị sai qua Prisma");
    } catch (error) {
      new AllExceptionsFilter().catch(error, host);
      assert.equal((body as { statusCode: number }).statusCode, 422);
      assert.doesNotMatch(JSON.stringify(body), /Prisma|unit_type|constraint/);
    }
    try {
      await prisma.user.create({ data: { id: randomUUID(), username: `vc01-${randomUUID()}`, passwordHash: "hash-thu", fullName: "Tài khoản thử", role: "UNIT", unitId: randomUUID(), createdAt: now, updatedAt: now } });
      assert.fail("Phải từ chối khóa ngoại đơn vị không tồn tại");
    } catch (error) {
      new AllExceptionsFilter().catch(error, host);
      assert.equal((body as { statusCode: number }).statusCode, 409);
      assert.doesNotMatch(JSON.stringify(body), /Prisma|FOREIGN|hash-thu/);
    }
    try {
      await prisma.$executeRaw`UPDATE audit_logs SET action = 'SUA' WHERE id = ${saved.id}::uuid`;
      assert.fail("Phải từ chối sửa nhật ký chỉ được thêm");
    } catch (error) {
      new AllExceptionsFilter().catch(error, host);
      assert.equal((body as { statusCode: number }).statusCode, 422);
      assert.doesNotMatch(JSON.stringify(body), /Prisma|UPDATE|append-only/);
    }
  } finally { await prisma.$disconnect(); }
});

/** Đưa helper quyền thật qua Nest HTTP vì ứng dụng chưa có route hồ sơ dùng helper này
 * UNIT không có unitId phải nhận 404, không để UUID giả đi vào truy vấn PostgreSQL
 * Controller chỉ tồn tại trong kiểm thử và không thêm endpoint vào ứng dụng
 */
test("UNIT thiếu đơn vị nhận 404 qua HTTP và PostgreSQL thật", async () => {
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  @Module({ controllers: [AccessTestController], providers: [{ provide: "ACCESS_TEST", useValue: new AccessService(prisma) }] })
  class AccessTestModule {}
  const app = await NestFactory.create(AccessTestModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, "127.0.0.1");
  try {
    const response = await fetch((await app.getUrl()) + "/quyen-thu");
    assert.equal(response.status, 404);
    assert.deepEqual((await response.json() as { details: unknown[] }).details, []);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
});

/** Đăng nhập tài khoản fixture và kiểm pipe UUID bằng backend cùng cơ sở dữ liệu thật
 * Mật khẩu thử được cấp qua biến môi trường, không ghi token hoặc mật khẩu vào log
 */
test("đăng nhập và UUID sai qua backend thật", async () => {
  const password = process.env.VC01_TEST_ADMIN_PASSWORD;
  assert.ok(password, "Cần mật khẩu tài khoản kiểm thử riêng");
  const login = await fetch(baseUrl + "/api/v1/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json() as { accessToken: string };
  const invalid = await fetch(baseUrl + "/api/v1/units/khong-hop-le", { headers: { authorization: `Bearer ${session.accessToken}` } });
  assert.equal(invalid.status, 400);
  const error = await invalid.json() as { message: string; details: unknown[] };
  assert.match(error.message, /[À-ỹ]/u);
  assert.deepEqual(error.details, []);
});

/** Kiểm tra HTTP của bản backend chạy thật nối cùng PostgreSQL test
 * Đầu vào sai, tuyến lạ và JSON hỏng phải giữ status cùng bốn trường công khai
 * Không yêu cầu provider ngoài hay gửi thông báo tới người thật
 */
test("hợp đồng lỗi trên backend thật", async () => {
  const requests: Array<[string, RequestInit, number]> = [
    ["/api/v1/health", {}, 200],
    ["/api/v1/khong-ton-tai", {}, 404],
    ["/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: '{"password":"bi-mat-thu"' }, 400],
    ["/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "test", password: "bi-mat-thu", extra: true }) }, 400],
  ];
  for (const [path, options, status] of requests) {
    const response: Response = await fetch(baseUrl + path, options);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, status);
    if (status !== 200) {
      assert.deepEqual(Object.keys(body).sort(), ["code", "details", "message", "statusCode"]);
      assert.match(String(body.message), /[À-ỹ]/u);
      assert.doesNotMatch(JSON.stringify(body), /bi-mat-thu|Prisma|SyntaxError|Cannot/);
    }
  }
});
