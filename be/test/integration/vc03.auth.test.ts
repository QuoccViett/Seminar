import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { NestFactory } from "@nestjs/core";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";

/** Kiểm Auth qua HTTP và PostgreSQL đã áp migration VC03 bằng tài khoản thử tạo riêng
 * Nhận VC03_TEST_DATABASE_URL trỏ đến cơ sở dữ liệu test, trả kết quả assertion và đóng ứng dụng sau kiểm tra
 * Kiểm mật khẩu demo bắt đổi, phiên cũ bị thu hồi, đăng nhập lại và xoay vòng refresh trên DB thật
 * Không xóa dữ liệu lịch sử append-only và không dùng tài khoản hoặc provider của người thật
 */
test("Auth hoạt động sau migration VC03", async () => {
  const databaseUrl = process.env.VC03_TEST_DATABASE_URL;
  assert.ok(databaseUrl && new URL(databaseUrl).pathname === "/vc03_test", "Cần database vc03_test riêng để chạy kiểm thử");
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = "vc03-test-secret-only-at-least-32-characters";
  process.env.WEB_ORIGINS = "http://127.0.0.1:5173";
  process.env.NODE_ENV = "test";
  process.env.TZ = "UTC";
  // Bản build giữ metadata decorator của TypeScript để Nest tiêm phụ thuộc đúng như khi chạy thật
  const buildRoot = "../../dist";
  const { AppModule } = await import(`${buildRoot}/app.module.js`);
  const { PrismaService } = await import(`${buildRoot}/prisma/prisma.service.js`);
  const { AllExceptionsFilter } = await import(`${buildRoot}/common/filters/all-exceptions.filter.js`);
  const { createApiValidationPipe } = await import(`${buildRoot}/common/pipes/api-validation.pipe.js`);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  const prisma = app.get<PrismaServiceType>(PrismaService);
  const base = await app.getUrl();
  const username = `vc03-${randomUUID()}`;
  const now = new Date();
  try {
    await prisma.user.create({ data: { id: randomUUID(), username, passwordHash: await bcrypt.hash("123456", 10), fullName: "Quản trị kiểm thử Auth", role: "ADMIN", mustChangePassword: true, createdAt: now, updatedAt: now } });
    // Gửi HTTP thật để đi qua controller, guard, service và DB cùng lúc
    const request = (path: string, body?: unknown, token?: string) => fetch(`${base}/api/v1/${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const login = await request("auth/login", { username, password: "123456" });
    assert.equal(login.status, 200);
    const initial = await login.json() as { accessToken: string; refreshToken: string; user: { mustChangePassword: boolean } };
    assert.equal(initial.user.mustChangePassword, true);
    assert.equal((await request("units", undefined, initial.accessToken)).status, 403);
    const changed = await request("auth/change-password", { currentPassword: "123456", newPassword: "MatkhauVC03kiemthu9" }, initial.accessToken);
    assert.equal(changed.status, 200);
    const next = await changed.json() as { accessToken: string; refreshToken: string };
    assert.equal((await request("auth/me", undefined, initial.accessToken)).status, 401);
    assert.equal((await request("auth/me", undefined, next.accessToken)).status, 200);
    const rotated = await request("auth/refresh", { refreshToken: next.refreshToken });
    assert.equal(rotated.status, 200);
    const tokens = await rotated.json() as { refreshToken: string };
    assert.notEqual(tokens.refreshToken, next.refreshToken);
    assert.equal((await request("auth/refresh", { refreshToken: next.refreshToken })).status, 401);
    assert.equal((await request("auth/refresh", { refreshToken: tokens.refreshToken })).status, 401);
    assert.equal((await request("auth/login", { username, password: "MatkhauVC03kiemthu9" })).status, 200);
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    assert.equal(user.credentialVersion, 1);
    assert.equal(user.mustChangePassword, false);
  } finally {
    await app.close();
  }
});
