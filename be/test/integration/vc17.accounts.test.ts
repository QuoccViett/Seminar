import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createVc12Harness } from "./vc12-support.js";

/** Chỉ khai báo các trường hồ sơ công khai được assertion kiểm qua API */
interface AccountPayload { fullName: string; email: string | null; phone: string | null; role: string; unitId: string | null }

/** Kiểm sửa hồ sơ và đổi quyền bằng HTTP thật trên DB VC17 riêng
 * Dữ liệu đều do harness tạo, provider ngoài tắt và không sửa tài khoản đã có
 * Sau đổi quyền phải thu hồi cả access, refresh và thiết bị cũ trước khi cấp phiên mới
 */
test("VC17 hồ sơ UNIT, đổi vai trò/đơn vị và thu hồi phiên cùng thiết bị", async () => {
  const h = await createVc12Harness({ url: process.env.VC17_TEST_DATABASE_URL, name: "vc17_test" });
  try {
    const scenario = await h.scenario(2, 100, [50, 35], false);
    const [owner, other] = scenario.records;
    const suffix = randomUUID().slice(0, 8);
    const userPath = `users/${owner.userId}`;
    const email = `vc17-profile-${suffix}@example.invalid`;
    const ownProfile = await h.request("PATCH", userPath, owner.token, { fullName: "  Người tự sửa hồ sơ  ", email: `  ${email.toUpperCase()}  `, phone: " 0900123456 " });
    assert.equal(ownProfile.status, 200);
    const profile = ownProfile.body as unknown as AccountPayload;
    assert.equal(profile.fullName, "Người tự sửa hồ sơ");
    assert.equal(profile.email, email);
    assert.equal(profile.phone, "0900123456");
    assert.equal(((await h.request("GET", userPath, owner.token)).body as unknown as AccountPayload).email, email);
    assert.equal((await h.request("PATCH", userPath, other.token, { fullName: "Không có quyền" })).status, 404);
    assert.equal((await h.request("PATCH", userPath, owner.token, { unitId: other.unitId })).status, 403);
    assert.equal((await h.request("PATCH", userPath, owner.token, { email: "khong-phai-email" })).status, 400);
    assert.equal((await h.request("PATCH", `users/${other.userId}`, h.adminToken, { email })).status, 409);
    assert.equal((await h.request("PATCH", userPath, owner.token, { email: null, phone: null })).status, 200);
    const cleared = await h.request("GET", userPath, owner.token);
    assert.equal((cleared.body as unknown as AccountPayload).email, null); assert.equal((cleared.body as unknown as AccountPayload).phone, null);

    const login = await h.request("POST", "auth/login", undefined, { username: owner.username, password: h.password });
    assert.equal(login.status, 200);
    const refreshToken = (login.body as unknown as { refreshToken: string }).refreshToken;
    const pushId = randomUUID();
    await h.prisma.webPushSubscription.create({ data: { id: pushId, userId: owner.userId, endpoint: `https://fcm.googleapis.com/qa-${suffix}`, p256dh: "fixture-only", auth: "fixture-only", createdAt: new Date(), updatedAt: new Date() } });
    const promoted = await h.request("PATCH", userPath, h.adminToken, { role: "ADMIN" });
    assert.equal(promoted.status, 200); assert.equal((promoted.body as unknown as AccountPayload).role, "ADMIN"); assert.equal((promoted.body as unknown as AccountPayload).unitId, null);
    assert.equal((await h.request("GET", "auth/me", owner.token)).status, 401);
    assert.equal((await h.request("POST", "auth/refresh", undefined, { refreshToken })).status, 401);
    assert.ok((await h.prisma.webPushSubscription.findUniqueOrThrow({ where: { id: pushId } })).revokedAt);
    assert.equal((await h.request("PATCH", userPath, h.adminToken, { role: "ADMIN", unitId: other.unitId })).status, 400);
    assert.equal((await h.request("PATCH", userPath, h.adminToken, { role: "UNIT" })).status, 400);
    assert.equal((await h.request("PATCH", userPath, h.adminToken, { role: "UNIT", unitId: randomUUID() })).status, 400);
    assert.equal((await h.request("PATCH", userPath, h.adminToken, { role: "UNIT", unitId: other.unitId })).status, 409);

    const newUnit = await h.request("POST", "units", h.adminToken, { code: `VC17-TRANSFER-${suffix}`, name: "Đơn vị chuyển quyền kiểm thử", unitType: "PHONG_NGHIEP_VU", isActive: true, sortOrder: 0 });
    assert.equal(newUnit.status, 201);
    assert.equal((await h.request("PATCH", `units/${newUnit.body.id}`, h.adminToken, { isActive: false })).status, 200);
    assert.equal((await h.request("PATCH", userPath, h.adminToken, { role: "UNIT", unitId: newUnit.body.id })).status, 400);
    assert.equal((await h.request("PATCH", `units/${newUnit.body.id}`, h.adminToken, { isActive: true })).status, 200);
    const promotedLogin = await h.request("POST", "auth/login", undefined, { username: owner.username, password: h.password });
    assert.equal(promotedLogin.status, 200);
    const demoted = await h.request("PATCH", userPath, h.adminToken, { role: "UNIT", unitId: newUnit.body.id });
    assert.equal(demoted.status, 200); assert.equal((demoted.body as unknown as AccountPayload).role, "UNIT"); assert.equal((demoted.body as unknown as AccountPayload).unitId, newUnit.body.id);
    assert.equal((await h.request("GET", "auth/me", promotedLogin.body.accessToken)).status, 401);
    const movedLogin = await h.request("POST", "auth/login", undefined, { username: owner.username, password: h.password });
    assert.equal(movedLogin.status, 200);
    assert.equal((await h.request("GET", `units/${newUnit.body.id}`, movedLogin.body.accessToken)).status, 200);
    assert.equal((await h.request("GET", `units/${owner.unitId}`, movedLogin.body.accessToken)).status, 404);
    assert.ok(await h.prisma.auditLog.count({ where: { entity: "User", entityId: owner.userId, action: "USER_UPDATED" } }) >= 4);
  } finally { await h.app.close(); }
});
