import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtAuthGuard, RolesGuard } from "./jwt-auth.guard.js";

type FakeRequest = {
  headers: { authorization?: string };
  user?: unknown;
};

function createContext(request: unknown) {
  return {
    getHandler: () => function handler() {},
    getClass: () => "controller",
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

test("JWT guard resolves current role and unit from the database", async () => {
  const request: FakeRequest = { headers: { authorization: "Bearer valid-token" } };
  const jwtService = {
    verifyAsync: async () => ({
      sub: "user-id",
      tokenUse: "access", ver: 0, exp: 9999999999,
      role: "ADMIN",
      unitId: "forged-unit",
    }),
  };
  const prisma = {
    user: {
      findUnique: async () => ({
        id: "user-id",
        role: "UNIT",
        unitId: "db-unit",
        isActive: true,
        credentialVersion: 0, mustChangePassword: false,
        unit: { isActive: true },
      }),
    },
  };
  const guard = new JwtAuthGuard(jwtService as never, prisma as never);

  assert.equal(await guard.canActivate(createContext(request)), true);
  assert.deepEqual(request.user, {
    id: "user-id",
    role: "UNIT",
    unitId: "db-unit",
  });
});

test("JWT guard rejects requests without a Bearer token", async () => {
  const request: FakeRequest = { headers: {} };
  const guard = new JwtAuthGuard(
    { verifyAsync: async () => ({}) } as never,
    { user: { findUnique: async () => null } } as never,
  );

  await assert.rejects(
    guard.canActivate(createContext(request)),
    UnauthorizedException,
  );
});

test("roles guard rejects an authenticated user with the wrong role", () => {
  const request: FakeRequest = {
    headers: {},
    user: { id: "unit-user", role: "UNIT", unitId: "unit-id" },
  };
  const reflector = {
    getAllAndOverride: () => ["ADMIN"],
  };
  const guard = new RolesGuard(reflector as never);

  assert.throws(
    () => guard.canActivate(createContext(request)),
    ForbiddenException,
  );
});

test("JWT guard rejects a deactivated account even with a valid token", async () => {
  const request: FakeRequest = { headers: { authorization: "Bearer valid-token" } };
  const guard = new JwtAuthGuard(
    { verifyAsync: async () => ({ sub: "user-id", tokenUse: "access" }) } as never,
    {
      user: {
        findUnique: async () => ({
          id: "user-id",
          role: "ADMIN",
          unitId: null,
          isActive: false,
          unit: null,
        }),
      },
    } as never,
  );

  await assert.rejects(
    guard.canActivate(createContext(request)),
    UnauthorizedException,
  );
});

test("JWT guard rejects a refresh-style token that is not an access token", async () => {
  const request: FakeRequest = { headers: { authorization: "Bearer valid-token" } };
  const guard = new JwtAuthGuard(
    { verifyAsync: async () => ({ sub: "user-id", tokenUse: "refresh" }) } as never,
    { user: { findUnique: async () => null } } as never,
  );

  await assert.rejects(
    guard.canActivate(createContext(request)),
    UnauthorizedException,
  );
});

test("roles guard allows a request when no roles are required", () => {
  const guard = new RolesGuard({ getAllAndOverride: () => undefined } as never);

  assert.equal(guard.canActivate(createContext({ headers: {} })), true);
});
/** Phiên bản cũ không được dùng sau khi mật khẩu đã thay đổi
 * Dữ liệu giả kiểm tra quyết định guard, không thay thế kiểm thử cơ sở dữ liệu thật
 */
test("JWT guard từ chối phiên bản xác thực cũ", async () => {
  const guard = new JwtAuthGuard(
    { verifyAsync: async () => ({ sub: "user-id", tokenUse: "access", ver: 0, exp: 9999999999 }) } as never,
    { user: { findUnique: async () => ({ id: "user-id", role: "ADMIN", unitId: null, isActive: true, credentialVersion: 1, mustChangePassword: false }) } } as never,
  );
  await assert.rejects(guard.canActivate(createContext({ headers: { authorization: "Bearer old" } })), UnauthorizedException);
});

/** Tài khoản còn cờ bắt buộc đổi mật khẩu bị chặn tại API nghiệp vụ dù JWT hợp lệ
 * Quyền được quyết định bởi backend thay vì trạng thái giao diện
 */
test("JWT guard chặn nghiệp vụ khi chưa đổi mật khẩu", async () => {
  const guard = new JwtAuthGuard(
    { verifyAsync: async () => ({ sub: "user-id", tokenUse: "access", ver: 1, exp: 9999999999 }) } as never,
    { user: { findUnique: async () => ({ id: "user-id", role: "ADMIN", unitId: null, isActive: true, credentialVersion: 1, mustChangePassword: true }) } } as never,
  );
  await assert.rejects(guard.canActivate(createContext({ headers: { authorization: "Bearer valid" } })), ForbiddenException);
});
