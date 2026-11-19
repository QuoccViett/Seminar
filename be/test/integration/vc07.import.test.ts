import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { NestFactory } from "@nestjs/core";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";

/** Tạo workbook 34 dòng hợp lệ trong bộ nhớ cho luồng HTTP thực
 * Đầu vào là hậu tố riêng của lần chạy; đầu ra có unitCode/username/email không trùng và email miền example.invalid
 * Cột phone được ghi chuỗi để kiểm tra số 0 đầu, workbook không được ghi ra đĩa hoặc gửi cho người thật
 */
async function createWorkbook(suffix: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import UNIT");
  sheet.addRow(["unitCode", "unitName", "unitType", "username", "fullName", "email", "phone"]);
  for (let index = 1; index <= 34; index += 1) {
    const number = String(index).padStart(2, "0");
    sheet.addRow([`VC07-${suffix}-${number}`, `Đơn vị kiểm thử ${number}`, "DON_VI_TRUC_THUOC", `vc07-${suffix}-${number}`, `Đơn vị kiểm thử ${number}`, `vc07-${suffix}-${number}@example.invalid`, `090000${String(index).padStart(4, "0")}`]);
    sheet.getCell(`G${index + 1}`).numFmt = "@";
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Tạo một workbook nhỏ để kiểm tra thay đổi dữ liệu DB giữa preview và confirm mà không kéo dài hash cho 34 dòng */
async function createSmallWorkbook(suffix: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import UNIT");
  sheet.addRow(["unitCode", "unitName", "unitType", "username", "fullName", "email", "phone"]);
  sheet.addRow([`VC07-STALE-${suffix}-01`, "Đơn vị giữ chỗ", "DON_VI_TRUC_THUOC", `vc07-stale-${suffix}-01`, "Đơn vị giữ chỗ", `vc07-stale-${suffix}-01@example.invalid`, "0900000001"]);
  sheet.addRow([`VC07-STALE-${suffix}-02`, "Đơn vị phải rollback", "DON_VI_TRUC_THUOC", `vc07-stale-${suffix}-02`, "Đơn vị phải rollback", `vc07-stale-${suffix}-02@example.invalid`, "0900000002"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Chạy lát import qua Nest HTTP và PostgreSQL chỉ với database riêng tên vc07_test
 * SMTP trỏ về Mailpit loopback, worker được dừng trước khi fixture xác nhận email nên không gọi provider hoặc gửi ra ngoài
 * Test chứng minh preview khô, confirm 34 account, idempotency, rollback khi dữ liệu DB đổi và quyền ADMIN
 */
test("VC07 import qua backend thật và PostgreSQL riêng", async () => {
  const databaseUrl = process.env.VC07_TEST_DATABASE_URL;
  assert.ok(databaseUrl && new URL(databaseUrl).pathname === "/vc07_test", "Cần PostgreSQL vc07_test riêng để kiểm thử");
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = "vc07-test-secret-only-at-least-32-characters";
  process.env.WEB_ORIGINS = "http://127.0.0.1:5173";
  process.env.PUBLIC_APP_URL = "http://127.0.0.1:5173";
  process.env.NODE_ENV = "test";
  process.env.TZ = "UTC";
  const initialPassword = randomBytes(12).toString("hex");
  process.env.INITIAL_ACCOUNT_PASSWORD = initialPassword;
  process.env.EMAIL_ENABLED = "true";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1026";
  process.env.SMTP_AUTH_REQUIRED = "false";
  process.env.SMTP_ALLOW_INSECURE_LOCAL = "true";
  process.env.MAIL_FROM = "vc07@example.invalid";
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.WEB_PUSH_ENABLED = "false";
  process.env.ZALO_ZNS_ENABLED = "false";
  const changedPassword = randomBytes(12).toString("hex");

  const distUrl = new URL("../../dist/", import.meta.url);
  const { AppModule } = await import(new URL("app.module.js", distUrl).href);
  const { PrismaService } = await import(new URL("prisma/prisma.service.js", distUrl).href);
  const { CredentialDispatchService } = await import(new URL("modules/notifications/credential-dispatch.service.js", distUrl).href);
  const { AllExceptionsFilter } = await import(new URL("common/filters/all-exceptions.filter.js", distUrl).href);
  const { createApiValidationPipe } = await import(new URL("common/pipes/api-validation.pipe.js", distUrl).href);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  const prisma = app.get<PrismaServiceType>(PrismaService);
  app.get(CredentialDispatchService).onModuleDestroy();
  const base = await app.getUrl();
  const suffix = randomUUID().slice(0, 8);
  const adminId = randomUUID();
  const adminUsername = `vc07-admin-${suffix}`;

  /** Gửi yêu cầu JSON tới Nest đang chạy và đọc response mà không ghi token hoặc mật khẩu ra log
   * Body chỉ được serialize khi có giá trị; token được gắn riêng ở Authorization như FE sử dụng
   */
  async function request(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  /** Upload byte workbook qua FormData như FE thực hiện, không gửi cờ loại file do client tự khai báo */
  async function preview(buffer: Buffer, token: string, key: string) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), "units.xlsx");
    const response = await fetch(`${base}/api/v1/users/import/preview`, { method: "POST", headers: { authorization: `Bearer ${token}`, "Idempotency-Key": key }, body: form });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  try {
    const now = new Date();
    await prisma.user.create({ data: { id: adminId, username: adminUsername, passwordHash: await bcrypt.hash("MatkhauVC07Admin9", 10), fullName: "Quản trị kiểm thử VC07", role: "ADMIN", mustChangePassword: false, createdAt: now, updatedAt: now } });
    const login = await request("POST", "auth/login", undefined, { username: adminUsername, password: "MatkhauVC07Admin9" });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const adminToken = login.body.accessToken as string;
    const templateResponse = await fetch(`${base}/api/v1/users/import/template`, { headers: { authorization: `Bearer ${adminToken}` } });
    assert.equal(templateResponse.status, 200);
    assert.match(templateResponse.headers.get("content-type") ?? "", /spreadsheetml\.sheet/);
    assert.equal((await templateResponse.arrayBuffer().then((bytes) => Buffer.from(bytes).readUInt32LE(0))), 0x04034b50);
    const workbook = await createWorkbook(suffix);
    const key = `vc07-${suffix}`;
    const beforeUsers = await prisma.user.count({ where: { username: { startsWith: `vc07-${suffix}-` } } });
    const beforeUnits = await prisma.unit.count({ where: { code: { startsWith: `VC07-${suffix}-` } } });

    const firstPreview = await preview(workbook, adminToken, key);
    assert.equal(firstPreview.status, 201);
    assert.equal(firstPreview.body.totalRows, 34);
    assert.equal(firstPreview.body.validRows, 34);
    assert.equal(firstPreview.body.invalidRows, 0);
    const previewRows = firstPreview.body.rows as Array<Record<string, unknown>>;
    assert.equal(previewRows[0]?.phone, "0900000001");
    assert.equal(await prisma.user.count({ where: { username: { startsWith: `vc07-${suffix}-` } } }), beforeUsers);
    assert.equal(await prisma.unit.count({ where: { code: { startsWith: `VC07-${suffix}-` } } }), beforeUnits);

    const retriedPreview = await preview(workbook, adminToken, key);
    assert.equal(retriedPreview.status, 201);
    assert.equal(retriedPreview.body.importId, firstPreview.body.importId);
    const otherWorkbook = await createWorkbook(`${suffix}-other`);
    assert.equal((await preview(otherWorkbook, adminToken, key)).status, 409);

    const staleWorkbook = await createSmallWorkbook(suffix);
    const stalePreview = await preview(staleWorkbook, adminToken, `stale-${suffix}`);
    assert.equal(stalePreview.status, 201);
    await prisma.unit.create({ data: { id: randomUUID(), code: `VC07-STALE-${suffix}-01`, name: "Tên đã đổi sau preview", unitType: "DON_VI_TRUC_THUOC", isActive: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() } });
    assert.equal((await request("POST", `users/import/${stalePreview.body.importId}/confirm`, adminToken, {})).status, 422);
    assert.equal(await prisma.user.count({ where: { username: { startsWith: `vc07-stale-${suffix}-` } } }), 0);
    assert.equal(await prisma.unit.count({ where: { code: { startsWith: `VC07-STALE-${suffix}-` } } }), 1);

    // Hai phiên xem trước khác khóa cùng chứa hai tài khoản phải tranh chấp trên cùng định danh dữ liệu
    // Chỉ một giao dịch được tạo đủ cả hai dòng, giao dịch còn lại báo xung đột nghiệp vụ và không tạo thêm bản ghi
    const competingSuffix = `${suffix}-race`;
    const competingWorkbook = await createSmallWorkbook(competingSuffix);
    const competingPreviews = await Promise.all([
      preview(competingWorkbook, adminToken, `race-a-${suffix}`),
      preview(competingWorkbook, adminToken, `race-b-${suffix}`),
    ]);
    assert.deepEqual(competingPreviews.map((item) => item.status), [201, 201]);
    const competingResults = await Promise.all(competingPreviews.map((item) =>
      request("POST", `users/import/${item.body.importId}/confirm`, adminToken, {}),
    ));
    assert.deepEqual(competingResults.map((item) => item.status).sort(), [200, 422]);
    assert.equal(await prisma.user.count({ where: { username: { startsWith: `vc07-stale-${competingSuffix}-` } } }), 2);
    assert.equal(await prisma.unit.count({ where: { code: { startsWith: `VC07-STALE-${competingSuffix}-` } } }), 2);
    assert.equal(await prisma.credentialDispatch.count({ where: { user: { username: { startsWith: `vc07-stale-${competingSuffix}-` } } } }), 2);

    const unitId = randomUUID();
    const unitUserId = randomUUID();
    const unitUsername = `vc07-deny-${suffix}`;
    const unitNow = new Date();
    await prisma.unit.create({ data: { id: unitId, code: `VC07-DENY-${suffix}`, name: "Đơn vị kiểm tra quyền", unitType: "DON_VI_TRUC_THUOC", isActive: true, sortOrder: 0, createdAt: unitNow, updatedAt: unitNow } });
    await prisma.user.create({ data: { id: unitUserId, username: unitUsername, passwordHash: await bcrypt.hash("MatkhauVC07Unit9", 10), fullName: "Tài khoản UNIT kiểm tra quyền", role: "UNIT", unitId, mustChangePassword: false, isActive: true, createdAt: unitNow, updatedAt: unitNow } });
    const unitLogin = await request("POST", "auth/login", undefined, { username: unitUsername, password: "MatkhauVC07Unit9" });
    assert.equal(unitLogin.status, 200);
    assert.equal((await preview(workbook, unitLogin.body.accessToken as string, `unit-${suffix}`)).status, 403);

    const importId = firstPreview.body.importId as string;
    // Hai xác nhận đồng thời cùng phiên phải trả cùng kết quả sau khóa transaction của PostgreSQL
    // Các phép đếm phía dưới kiểm hậu điều kiện thật để phát hiện tạo trùng dù cả hai HTTP đều thành công
    const [confirmed, concurrentConfirm] = await Promise.all([
      request("POST", `users/import/${importId}/confirm`, adminToken, {}),
      request("POST", `users/import/${importId}/confirm`, adminToken, {}),
    ]);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(concurrentConfirm.status, 200, JSON.stringify(concurrentConfirm.body));
    assert.deepEqual(concurrentConfirm.body, confirmed.body);
    assert.equal(confirmed.body.createdCount, 34);
    assert.equal(confirmed.body.unitsCreated, 34);
    const accounts = confirmed.body.accounts as Array<Record<string, unknown>>;
    assert.equal(accounts.length, 34);
    assert.equal(accounts.every((account) => account.email && (account.channels as Array<Record<string, unknown>>).some((item) => item.channel === "EMAIL" && item.status === "PENDING")), true);
    assert.equal(await prisma.user.count({ where: { username: { startsWith: `vc07-${suffix}-` } } }), 34);
    assert.equal(await prisma.unit.count({ where: { code: { startsWith: `VC07-${suffix}-` } } }), 34);
    assert.equal(await prisma.credentialDispatch.count({ where: { user: { username: { startsWith: `vc07-${suffix}-` } } } }), 34);

    const firstAccount = accounts[0]!;
    const passwordAccount = accounts[1]!;
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: passwordAccount.userId as string } });
    assert.equal(stored.mustChangePassword, true);
    assert.equal(await bcrypt.compare(initialPassword, stored.passwordHash), true);
    assert.notEqual(stored.passwordHash, initialPassword);
    const importedLogin = await request("POST", "auth/login", undefined, { username: passwordAccount.username, password: initialPassword });
    assert.equal(importedLogin.status, 200);
    assert.equal((await request("GET", `users/${passwordAccount.userId}`, importedLogin.body.accessToken as string)).status, 403);
    assert.equal((await request("POST", "auth/change-password", importedLogin.body.accessToken as string, { currentPassword: initialPassword, newPassword: changedPassword })).status, 200);
    const repeatedConfirm = await request("POST", `users/import/${importId}/confirm`, adminToken, {});
    assert.deepEqual(repeatedConfirm.body, confirmed.body);
    assert.equal(await prisma.user.count({ where: { username: { startsWith: `vc07-${suffix}-` } } }), 34);

    const wrongFile = Buffer.from("không phải file Excel");
    assert.equal((await preview(wrongFile, adminToken, `bad-${suffix}`)).status, 422);
    const dispatch = await prisma.credentialDispatch.findUniqueOrThrow({ where: { userId_credentialVersion: { userId: firstAccount.userId as string, credentialVersion: 0 } }, include: { deliveries: true } });
    assert.ok(dispatch.ciphertext && !dispatch.ciphertext.includes(initialPassword));
    assert.equal(dispatch.emailConfirmedAt, null);
    assert.equal(dispatch.deliveries.find((delivery) => delivery.channel === "EMAIL")?.errorCode, "EMAIL_UNCONFIRMED");
    assert.equal(await prisma.auditLog.count({ where: { entity: "User", action: "USER_IMPORTED", entityId: { in: accounts.map((account) => account.userId as string) } } }), 34);

    const firstEmail = firstAccount.email as string;
    assert.equal((await request("POST", `users/${firstAccount.userId}/credential-deliveries/confirm-email`, adminToken, { email: firstEmail })).status, 200);
    await prisma.credentialDelivery.updateMany({ where: { dispatchId: dispatch.id, channel: "EMAIL" }, data: { status: "FAILED", errorCode: "TEMPORARY_FAILURE", attemptCount: 5 } });
    const retry = await request("POST", `users/${firstAccount.userId}/credential-deliveries/retry`, adminToken, { channel: "EMAIL" });
    assert.deepEqual(retry.body, { userId: firstAccount.userId, channel: "EMAIL", status: "PENDING" });
    const retriedDelivery = await prisma.credentialDelivery.findFirstOrThrow({ where: { dispatchId: dispatch.id, channel: "EMAIL" } });
    assert.equal(retriedDelivery.status, "PENDING");
    assert.equal(retriedDelivery.attemptCount, 0);
  } finally {
    await app.close();
  }
});
