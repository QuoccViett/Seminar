import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { AUTHORIZED_ROLES } from "../../common/decorators/roles.decorator.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { JwtAuthGuard, RolesGuard } from "../../common/guards/jwt-auth.guard.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { UpdateUserDto } from "./dto/update-user.dto.js";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto.js";
import { RetryCredentialDeliveryDto } from "./dto/retry-credential-delivery.dto.js";
import { UsersController } from "./users.controller.js";

const ADMIN: CurrentUser = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "ADMIN",
  unitId: null,
};

const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const UNIT_ID = "33333333-3333-4333-8333-333333333333";

function getStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "getStatus" in error &&
    typeof error.getStatus === "function"
  ) {
    return error.getStatus();
  }
  return undefined;
}

function makeController() {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string) => async (...args: unknown[]) => {
    (calls[name] ??= []).push(args);
    return { handledBy: name };
  };
  const service = {
    findAll: record("findAll"),
    findOne: record("findOne"),
    create: record("create"),
    update: record("update"),
    resetPassword: record("resetPassword"),
    updateStatus: record("updateStatus"),
  };
  const userImport = {
    createTemplate: record("createTemplate"),
    preview: record("previewImport"),
    confirm: record("confirmImport"),
  };
  const credentials = {
    retryChannel: record("retryCredentialDelivery"),
  };
  return { controller: new UsersController(service as never, userImport as never, credentials as never), calls };
}

async function validate<T extends object>(
  dtoClass: new () => T,
  body: unknown,
): Promise<T> {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    expectedType: dtoClass,
  });
  return pipe.transform(body, { type: "body", metatype: dtoClass });
}

function rolesOf(handler: object): unknown {
  return Reflect.getMetadata(AUTHORIZED_ROLES, handler);
}

// Chuyển tiếp bộ lọc và danh tính tới service để audit nhận đúng người thao tác

test("findAll forwards every query filter", async () => {
  const { controller, calls } = makeController();

  await controller.findAll("1", "20", "UNIT", UNIT_ID, "true", "demo");

  assert.deepEqual(calls.findAll?.[0], [
    { page: "1", pageSize: "20", role: "UNIT", unitId: UNIT_ID, isActive: "true", q: "demo" },
  ]);
});

test("create forwards the dto", async () => {
  const { controller, calls } = makeController();
  const dto = { username: "coso35", fullName: "Cơ sở 35", role: "UNIT" } as CreateUserDto;

  await controller.create(dto, ADMIN);

  assert.deepEqual(calls.create?.[0], [dto, ADMIN.id]);
});

test("findOne forwards id and current user", async () => {
  const { controller, calls } = makeController();

  await controller.findOne(TARGET_ID, ADMIN);

  assert.deepEqual(calls.findOne?.[0], [TARGET_ID, ADMIN]);
});

test("update forwards id, current user and dto in that order", async () => {
  const { controller, calls } = makeController();
  const dto = { fullName: "Tên mới" } as UpdateUserDto;

  await controller.update(TARGET_ID, ADMIN, dto);

  assert.deepEqual(calls.update?.[0], [TARGET_ID, ADMIN, dto]);
});

test("resetPassword forwards id and actor for audit", async () => {
  const { controller, calls } = makeController();

  await controller.resetPassword(TARGET_ID, ADMIN);

  assert.deepEqual(calls.resetPassword?.[0], [TARGET_ID, ADMIN.id]);
});

/** Xác nhận controller gắn ID Admin từ token vào preview thay vì nhận danh tính do client gửi */
test("previewImport forwards the uploaded file, idempotency key and authenticated administrator", async () => {
  const { controller, calls } = makeController();
  const file = { originalname: "units.xlsx", size: 100, buffer: Buffer.from("xlsx") };

  await controller.previewImport(file, "preview-key", ADMIN);

  assert.deepEqual(calls.previewImport?.[0], [file, ADMIN.id, "preview-key"]);
});

/** Xác nhận phiên Import chỉ được tạo tiếp với ID đã chọn và danh tính Admin hiện hành */
test("confirmImport forwards the session identifier and authenticated administrator", async () => {
  const { controller, calls } = makeController();

  await controller.confirmImport(TARGET_ID, ADMIN);

  assert.deepEqual(calls.confirmImport?.[0], [TARGET_ID, ADMIN.id]);
});

/** Bảo đảm yêu cầu retry luôn lấy actor từ token và không nhận người thao tác trong body */
test("retryCredentialDelivery forwards the account, requested channel and authenticated administrator", async () => {
  const { controller, calls } = makeController();

  await controller.retryCredentialDelivery(TARGET_ID, { channel: "EMAIL" }, ADMIN);

  assert.deepEqual(calls.retryCredentialDelivery?.[0], [TARGET_ID, "EMAIL", ADMIN.id]);
});

/** Chỉ chấp nhận hai kênh có provider; ZNS không được đưa vào hàng đợi retry khi mặc định đang tắt */
test("RetryCredentialDeliveryDto accepts Email and Web Push but rejects Zalo ZNS", async () => {
  assert.equal((await validate(RetryCredentialDeliveryDto, { channel: "EMAIL" })).channel, "EMAIL");
  assert.equal((await validate(RetryCredentialDeliveryDto, { channel: "WEB_PUSH" })).channel, "WEB_PUSH");
  await assert.rejects(validate(RetryCredentialDeliveryDto, { channel: "ZALO_ZNS" }), (error: unknown) => getStatus(error) === 400);
});

/** Bảo đảm cả ba endpoint import chỉ dành cho ADMIN sau khi controller-level guards xác thực token */
test("template, preview and confirm import routes are ADMIN-only", () => {
  for (const handler of [UsersController.prototype.importTemplate, UsersController.prototype.previewImport, UsersController.prototype.confirmImport, UsersController.prototype.retryCredentialDelivery]) {
    assert.deepEqual(rolesOf(handler), ["ADMIN"]);
  }
});

test("updateStatus forwards id, isActive and current user", async () => {
  const { controller, calls } = makeController();

  await controller.updateStatus(TARGET_ID, ADMIN, { isActive: false });

  assert.deepEqual(calls.updateStatus?.[0], [TARGET_ID, false, ADMIN]);
});

// ---------- Bảo vệ route và phân quyền ----------

test("the whole controller requires JwtAuthGuard and RolesGuard", () => {
  assert.deepEqual(Reflect.getMetadata("__guards__", UsersController), [
    JwtAuthGuard,
    RolesGuard,
  ]);
});

test("listing, creating, resetting and locking are ADMIN-only", () => {
  for (const handler of [
    UsersController.prototype.findAll,
    UsersController.prototype.create,
    UsersController.prototype.resetPassword,
    UsersController.prototype.updateStatus,
  ]) {
    assert.deepEqual(rolesOf(handler), ["ADMIN"]);
  }
});

test("ADMIN and UNIT can view and update an account (service enforces ownership)", () => {
  assert.deepEqual(rolesOf(UsersController.prototype.findOne), ["ADMIN", "UNIT"]);
  assert.deepEqual(rolesOf(UsersController.prototype.update), ["ADMIN", "UNIT"]);
});

test("reset-password answers 200 instead of 201", () => {
  assert.equal(
    Reflect.getMetadata("__httpCode__", UsersController.prototype.resetPassword),
    200,
  );
});

// ---------- Kiểm tra DTO ----------

test("CreateUserDto accepts a valid UNIT account", async () => {
  const dto = await validate(CreateUserDto, {
    username: "coso35",
    fullName: "Cơ sở 35",
    role: "UNIT",
    unitId: UNIT_ID,
    email: "coso35@example.com",
    phone: "0901234567",
  });

  assert.equal(dto.role, "UNIT");
});

test("CreateUserDto accepts an ADMIN account without unitId", async () => {
  const dto = await validate(CreateUserDto, {
    username: "admin2",
    fullName: "Quản trị 2",
    role: "ADMIN",
  });

  assert.equal(dto.unitId, undefined);
});

test("CreateUserDto strips fields the client must not control", async () => {
  const dto = await validate(CreateUserDto, {
    username: "coso35",
    fullName: "Cơ sở 35",
    role: "UNIT",
    unitId: UNIT_ID,
    passwordHash: "hacked",
    isActive: false,
  });

  assert.equal("passwordHash" in dto, false);
  assert.equal("isActive" in dto, false);
});

test("CreateUserDto rejects an unknown role", async () => {
  await assert.rejects(
    validate(CreateUserDto, { username: "a", fullName: "b", role: "SUPERUSER" }),
    (error: unknown) => getStatus(error) === 400,
  );
});

test("CreateUserDto rejects a malformed email", async () => {
  await assert.rejects(
    validate(CreateUserDto, {
      username: "a",
      fullName: "b",
      role: "ADMIN",
      email: "not-an-email",
    }),
    (error: unknown) => getStatus(error) === 400,
  );
});

test("CreateUserDto rejects a unitId that is not a UUID", async () => {
  await assert.rejects(
    validate(CreateUserDto, {
      username: "a",
      fullName: "b",
      role: "UNIT",
      unitId: "abc",
    }),
    (error: unknown) => getStatus(error) === 400,
  );
});

test("UpdateUserDto accepts a partial body and null email", async () => {
  const dto = await validate(UpdateUserDto, { fullName: "Tên mới", email: null });

  assert.equal(dto.fullName, "Tên mới");
  assert.equal(dto.email, null);
});

test("UpdateUserDto strips isActive (locking goes through /status)", async () => {
  const dto = await validate(UpdateUserDto, { fullName: "Tên mới", isActive: false });

  assert.equal(dto.fullName, "Tên mới");
  assert.equal("isActive" in dto, false);
});

test("UpdateUserStatusDto requires a real boolean", async () => {
  const dto = await validate(UpdateUserStatusDto, { isActive: false });
  assert.equal(dto.isActive, false);

  await assert.rejects(
    validate(UpdateUserStatusDto, { isActive: "false" }),
    (error: unknown) => getStatus(error) === 400,
  );
  await assert.rejects(
    validate(UpdateUserStatusDto, {}),
    (error: unknown) => getStatus(error) === 400,
  );
});
