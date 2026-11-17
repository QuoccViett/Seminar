import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { NestFactory } from "@nestjs/core";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";

/** Kiểm luồng quản trị VC04 qua Nest HTTP và PostgreSQL riêng sau khi áp migration
 * Chỉ chạy khi VC04_TEST_DATABASE_URL trỏ tới vc04_test; fixture không chứa người nhận thật
 * Kiểm tạo/sửa/tìm kiếm, quyền UNIT, cạnh tranh ADMIN cuối, audit và thu hồi token
 */
test("VC04 quản trị qua backend và PostgreSQL thật", async () => {
  const databaseUrl = process.env.VC04_TEST_DATABASE_URL;
  assert.ok(databaseUrl && new URL(databaseUrl).pathname === "/vc04_test", "Cần PostgreSQL vc04_test riêng để kiểm thử");
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = "vc04-test-secret-only-at-least-32-characters";
  process.env.WEB_ORIGINS = "http://127.0.0.1:5173";
  process.env.NODE_ENV = "test";
  process.env.TZ = "UTC";
  // Nạp bản build để Nest giữ metadata decorator, dùng đường dẫn động vì dist không phát hành khai báo kiểu
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
  const suffix = randomUUID().slice(0, 8);
  const adminName = `vc04-admin-${suffix}`;
  const now = new Date();

  /** Gửi yêu cầu HTTP thật với token tùy chọn, chỉ parse JSON từ phản hồi của ứng dụng
   * Body vắng mặt dùng GET mặc định; PATCH và POST được chỉ định ở từng phép kiểm
   */
  async function request(method: string, path: string, body?: unknown, token?: string) {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Mỗi route trả một cấu trúc khác nhau; các phép kiểm phía dưới xác nhận trường cần dùng theo từng route
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, body: await response.json() as Record<string, any> };
  }

  try {
    await prisma.user.create({ data: { id: randomUUID(), username: adminName, passwordHash: await bcrypt.hash("MatkhauVC04kiemthu9", 10), fullName: "Quản trị kiểm thử", role: "ADMIN", mustChangePassword: false, createdAt: now, updatedAt: now } });
    const login = await request("POST", "auth/login", { username: adminName, password: "MatkhauVC04kiemthu9" });
    assert.equal(login.status, 200);
    const adminToken = login.body.accessToken as string;

    // Đơn vị tạo từ API phải được tìm theo q và giữ đúng loại đã CHECK trong PostgreSQL
    const unit = await request("POST", "units", { code: `VC04-${suffix}`, name: "Đơn vị kiểm thử", unitType: "DON_VI_TRUC_THUOC" }, adminToken);
    assert.equal(unit.status, 201, JSON.stringify(unit.body));
    const unitId = unit.body.id as string;
    const other = await request("POST", "units", { code: `VC04-OTHER-${suffix}`, name: "Đơn vị khác" }, adminToken);
    assert.equal(other.status, 201);
    const foundUnits = await request("GET", `units?q=${suffix}`, undefined, adminToken);
    assert.equal(foundUnits.status, 200);
    assert.equal(foundUnits.body.total, 2);
    assert.equal(foundUnits.body.items[0].id !== foundUnits.body.items[1].id, true);
    assert.equal((await request("POST", "units", { code: `VC04-${suffix}`, name: "Mã đã tồn tại" }, adminToken)).status, 409);

    // Cấp tài khoản không tự nhận là đã gửi credential và không lộ hash trong GET
    const created = await request("POST", "users", { username: `VC04-UNIT-${suffix}`, fullName: "Tài khoản kiểm thử", role: "UNIT", unitId, email: `  VC04-${suffix}@EXAMPLE.TEST  `, phone: "0901234567" }, adminToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.username, `vc04-unit-${suffix}`);
    assert.equal(created.body.email, `vc04-${suffix}@example.test`);
    assert.equal(created.body.temporaryPassword, "123456");
    assert.equal(created.body.credentialsSentAt, null);
    const userId = created.body.id as string;
    const listed = await request("GET", `users?q=${suffix}`, undefined, adminToken);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.items.some((item: Record<string, unknown>) => item.id === userId));
    assert.equal(JSON.stringify(listed.body).includes("passwordHash"), false);
    assert.equal(JSON.stringify((await request("GET", `users/${userId}`, undefined, adminToken)).body).includes("passwordHash"), false);
    assert.equal((await request("GET", `units/${unitId}/users`, undefined, adminToken)).body.items[0].id, userId);
    assert.equal((await request("POST", "users", { username: created.body.username, fullName: "Tên trùng", role: "ADMIN" }, adminToken)).status, 409);
    assert.equal((await request("POST", "users", { username: `vc04-email-${suffix}`, fullName: "Email trùng", role: "ADMIN", email: created.body.email }, adminToken)).status, 409);
    assert.equal((await request("POST", "users", { username: `vc04-unit-duplicate-${suffix}`, fullName: "Đơn vị trùng", role: "UNIT", unitId }, adminToken)).status, 409);

    // UNIT phải đổi mật khẩu, sau đó chỉ đọc đơn vị và hồ sơ thuộc quyền mình
    const unitLogin = await request("POST", "auth/login", { username: created.body.username, password: "123456" });
    assert.equal(unitLogin.status, 200);
    assert.equal((await request("GET", `units/${unitId}`, undefined, unitLogin.body.accessToken)).status, 403);
    const changed = await request("POST", "auth/change-password", { currentPassword: "123456", newPassword: "MatkhauVC04DonVi9" }, unitLogin.body.accessToken);
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const unitToken = changed.body.accessToken as string;
    assert.equal((await request("GET", `units/${other.body.id}`, undefined, unitToken)).status, 404);
    assert.equal((await request("GET", `users/${userId}`, undefined, unitToken)).status, 200);
    assert.equal((await request("PATCH", `users/${userId}`, { role: "ADMIN" }, unitToken)).status, 403);

    // Khóa tài khoản phải làm access token cũ mất hiệu lực và lưu audit trong cùng nghiệp vụ
    const locked = await request("PATCH", `users/${userId}/status`, { isActive: false }, adminToken);
    assert.equal(locked.status, 200, JSON.stringify(locked.body));
    assert.equal((await request("GET", `users/${userId}`, undefined, unitToken)).status, 401);
    assert.ok(await prisma.auditLog.count({ where: { entity: "User", entityId: userId, action: "USER_DEACTIVATED" } }));
    assert.equal((await request("PATCH", `users/${userId}/status`, { isActive: true }, adminToken)).status, 200);
    const beforeResetLogin = await request("POST", "auth/login", { username: created.body.username, password: "MatkhauVC04DonVi9" });
    assert.equal(beforeResetLogin.status, 200);
    const beforeResetToken = beforeResetLogin.body.accessToken as string;
    const reset = await request("POST", `users/${userId}/reset-password`, {}, adminToken);
    assert.equal(reset.status, 200);
    assert.equal(reset.body.temporaryPassword, "123456");
    assert.equal(reset.body.credentialsSentAt, null);

    // Đặt lại và khóa đơn vị đều thu hồi access token sau khi tài khoản đổi mật khẩu
    assert.equal((await request("GET", `users/${userId}`, undefined, beforeResetToken)).status, 401);
    const afterResetLogin = await request("POST", "auth/login", { username: created.body.username, password: "123456" });
    assert.equal(afterResetLogin.status, 200);
    const afterResetChanged = await request("POST", "auth/change-password", { currentPassword: "123456", newPassword: "MatkhauVC04SauReset9" }, afterResetLogin.body.accessToken);
    assert.equal(afterResetChanged.status, 200);
    assert.equal((await request("PATCH", `units/${unitId}`, { isActive: false }, adminToken)).status, 200);
    assert.equal((await request("GET", `users/${userId}`, undefined, afterResetChanged.body.accessToken)).status, 401);
    assert.ok(await prisma.auditLog.count({ where: { entity: "Unit", entityId: unitId, action: "UNIT_UPDATED" } }));

    // Hai ADMIN khóa chéo đồng thời phải để lại ít nhất một tài khoản quản trị hoạt động
    const second = await request("POST", "users", { username: `vc04-b-${suffix}`, fullName: "Quản trị thứ hai", role: "ADMIN" }, adminToken);
    assert.equal(second.status, 201);
    const secondLogin = await request("POST", "auth/login", { username: second.body.username, password: "123456" });
    assert.equal(secondLogin.status, 200);
    const secondChanged = await request("POST", "auth/change-password", { currentPassword: "123456", newPassword: "MatkhauVC04Admin9" }, secondLogin.body.accessToken);
    assert.equal(secondChanged.status, 200);
    // Cạnh tranh chỉ chứng minh ADMIN cuối khi database thử có đúng hai ADMIN hoạt động
    assert.equal(await prisma.user.count({ where: { role: "ADMIN", isActive: true } }), 2, "Cần database thử mới với đúng hai ADMIN hoạt động");
    const [b, c] = await Promise.all([
      request("PATCH", `users/${second.body.id}/status`, { isActive: false }, adminToken),
      request("PATCH", `users/${login.body.user.id}/status`, { isActive: false }, secondChanged.body.accessToken),
    ]);
    assert.ok([b.status, c.status].includes(200), JSON.stringify([b, c]));
    assert.ok([b.status, c.status].some((status) => status === 401 || status === 422), JSON.stringify([b, c]));
    assert.equal(await prisma.user.count({ where: { id: { in: [login.body.user.id, second.body.id] }, role: "ADMIN", isActive: true } }), 1);
  } finally {
    await app.close();
  }
});
