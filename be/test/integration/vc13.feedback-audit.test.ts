import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createVc12Harness } from "./vc12-support.js";

/** Shape công khai tối thiểu cho kiểm HTTP, không giữ raw token hoặc lỗi driver trong báo cáo */
interface Entry {
  id: string; evaluationId: string; authorId: string; authorName: string; actorId: string | null; actorName: string;
  type: string; content: string; createdAt: string; action: string; entity: string; entityId: string;
  fromStatus: string; toStatus: string; comment: string; code: string; message: string;
  before: { adminScore: string }; after: { adminScore: string; adminComment: string };
}
interface Payload extends Entry { items: Entry[]; page: number; pageSize: number; total: number; canPost: boolean; allowedTypes: string[]; lockedReason: string | null; }

/** Chạy Nest và PostgreSQL thật với fixture điều kiện trước VC12, không gửi mạng ra provider
 * Mỗi ca có UUID riêng và không reset DB, dùng HTTP cho nghiệp vụ và SQL chỉ để kiểm ràng buộc/fixture
 */
test("VC13 phản hồi, lịch sử và audit trên HTTP/PostgreSQL thật", async (suite) => {
  // Cô lập tệp xuất của phép kiểm để kiểm bù lỗi không chạm kho báo cáo đang dùng
  process.env.REPORT_EXPORT_DIR = ".tmp/vc13-report-exports";
  const h = await createVc12Harness({ url: process.env.VC13_TEST_DATABASE_URL, name: "vc13_test" });

  /** Gửi request thật và giữ status/header để kiểm quyền và cache, không in header xác thực */
  async function api(method: string, path: string, token = h.adminToken, body?: unknown) {
    const response = await fetch(`${h.base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() as Payload };
  }

  try {
    await suite.test("quyền, DTO, route chuẩn và trạng thái trước giờ mở", async () => {
      const s = await h.scenario(2); const [a, b] = s.records; const path = `evaluations/${a.evaluationId}/feedback`;
      assert.equal((await api("GET", path, "")).status, 401);
      for (const suffix of ["feedback", "status-history"]) assert.equal((await api("GET", `evaluations/${a.evaluationId}/${suffix}`, b.token)).status, 404);
      assert.equal((await api("POST", path, b.token, { type: "UNIT_REPLY", content: "Ngoài phạm vi" })).status, 404);
      assert.equal((await api("GET", "admin/audit-logs", a.token)).status, 403);
      assert.equal((await api("GET", "audit-logs")).status, 404);
      for (const body of [{ type: "SUPPLEMENT_REQUEST", content: "Sai luồng" }, { type: "GENERAL", content: " " }, { type: "GENERAL", content: "<script>1</script>" }, { type: "GENERAL", content: "x".repeat(4001) }, { type: "GENERAL", content: "Nội dung", authorId: h.adminId }]) assert.equal((await api("POST", path, h.adminToken, body)).status, 400);
      assert.equal((await api("POST", path, a.token, { type: "GENERAL", content: "Giả vai trò" })).status, 403);
      assert.equal((await api("POST", path, h.adminToken, { type: "UNIT_REPLY", content: "Giả vai trò" })).status, 403);
      // Fixture trước mở giữ start nhỏ hơn deadline để CHECK lịch thật tiếp tục hoạt động
      await h.prisma.evaluationPeriod.update({ where: { id: s.periodId }, data: { selfEvalStart: new Date(Date.now() + 60000), selfEvalDeadline: new Date(Date.now() + 3600000) } });
      assert.equal((await api("GET", path, a.token)).status, 403);
      assert.equal((await api("POST", path, a.token, { type: "UNIT_REPLY", content: "Chưa mở" })).status, 403);
      assert.equal((await api("GET", path)).status, 200);
      for (const query of ["pageSize=101", "page=0", "from=sai", "actorId=sai", "limit=20", "from=2026-11-19T00%3A00%3A00Z&to=2026-11-18T00%3A00%3A00Z"]) assert.equal((await api("GET", `admin/audit-logs?${query}`)).status, 400);
      assert.equal((await api("GET", "admin/audit-logs/sai-ma")).status, 400);
      assert.equal((await api("GET", `admin/audit-logs/${randomUUID()}`)).status, 404);
    });

    await suite.test("trao đổi hai vai trò, pagination, hộp thư và rollback nguyên tử", async () => {
      const s = await h.scenario(2); const [a, b] = s.records; const path = `evaluations/${a.evaluationId}/feedback`;
      const general = await api("POST", path, h.adminToken, { type: "GENERAL", content: "  Nhận xét chung có dấu\nDòng tiếp theo  " });
      assert.equal(general.status, 201); assert.equal(general.body.authorId, h.adminId); assert.equal(general.body.content, "Nhận xét chung có dấu\nDòng tiếp theo");
      assert.equal((await api("POST", path, a.token, { type: "UNIT_REPLY", content: "Đơn vị đã giải trình" })).status, 201);
      const explanation = await api("POST", `evaluations/${b.evaluationId}/feedback`, h.adminToken, { type: "EXPLANATION_REQUEST", content: "Đề nghị giải trình" });
      assert.equal(explanation.status, 201);
      const page = await api("GET", `${path}?pageSize=1`, a.token); const next = await api("GET", `${path}?pageSize=1&page=2`, a.token);
      assert.equal(page.cache, "no-store"); assert.equal(page.body.total, 2); assert.notEqual(page.body.items[0].id, next.body.items[0].id);
      assert.deepEqual(page.body.allowedTypes, ["UNIT_REPLY"]); assert.ok(page.body.items[0].authorName);
      const notice = await h.prisma.notification.findFirstOrThrow({ where: { userId: a.userId, dedupeKey: `feedback:${general.body.id}` }, include: { deliveries: true } });
      assert.equal(notice.deliveries.length, 0); assert.doesNotMatch(notice.body, /Nhận xét chung/);
      assert.equal(await h.prisma.auditLog.count({ where: { entityId: notice.id, action: "NOTIFICATION_QUEUED", actorId: null } }), 1);

      const fresh = await h.scenario(); const freshPath = `evaluations/${fresh.records[0].evaluationId}/feedback`;
      const record = h.audit.record.bind(h.audit);
      h.audit.record = async () => { throw new Error("Lỗi kiểm thử audit có chủ đích"); };
      try { const failed = await api("POST", freshPath, h.adminToken, { type: "GENERAL", content: "Phải rollback" }); assert.equal(failed.status, 500); assert.doesNotMatch(JSON.stringify(failed.body), /Prisma|SQL|Lỗi kiểm thử/); }
      finally { h.audit.record = record; }
      assert.equal(await h.prisma.evaluationFeedback.count({ where: { evaluationId: fresh.records[0].evaluationId } }), 0);
      const notify = h.notifications.notifyUser.bind(h.notifications);
      h.notifications.notifyUser = async () => { throw new Error("Lỗi kiểm thử hộp thư"); };
      try { assert.equal((await api("POST", freshPath, h.adminToken, { type: "GENERAL", content: "Hộp thư rollback" })).status, 500); }
      finally { h.notifications.notifyUser = notify; }
      assert.equal(await h.prisma.evaluationFeedback.count({ where: { evaluationId: fresh.records[0].evaluationId } }), 0);
      const notificationCount = await h.prisma.notification.count();
      h.audit.record = async (payload, tx) => { if (payload.action === "NOTIFICATION_QUEUED") throw new Error("Lỗi kiểm audit hộp thư"); await record(payload, tx); };
      try { assert.equal((await api("POST", freshPath, h.adminToken, { type: "GENERAL", content: "Audit hộp thư rollback" })).status, 500); }
      finally { h.audit.record = record; }
      assert.equal(await h.prisma.notification.count(), notificationCount);
      assert.equal(await h.prisma.evaluationFeedback.count({ where: { evaluationId: fresh.records[0].evaluationId } }), 0);
      assert.equal((await api("POST", freshPath, h.adminToken, { type: "GENERAL", content: "Gửi lại sau lỗi" })).status, 201);
    });

    await suite.test("hai request cạnh tranh và giới hạn toàn bộ hồ sơ không vượt quota", async () => {
      const s = await h.scenario(2); const a = s.records[0]; const path = `evaluations/${a.evaluationId}/feedback`;
      const pair = await Promise.all([1, 2].map((index) => api("POST", path, a.token, { type: "UNIT_REPLY", content: `Nội dung ${index}` })));
      assert.deepEqual(pair.map((item) => item.status).sort(), [201, 429]);
      const b = s.records[1]; const now = new Date();
      await h.prisma.evaluationFeedback.createMany({ data: Array.from({ length: 20 }, () => ({ id: randomUUID(), evaluationId: b.evaluationId, authorId: b.userId, type: "UNIT_REPLY", content: "Fixture giới hạn theo giờ", createdAt: new Date(+now - 60000) })) });
      assert.equal((await api("POST", `evaluations/${b.evaluationId}/feedback`, b.token, { type: "UNIT_REPLY", content: "Vượt quota" })).status, 429);
      assert.equal(await h.prisma.evaluationFeedback.count({ where: { authorId: a.userId } }), 1);
    });

    await suite.test("audit điểm 8 → 6 có người, thời gian, lý do và bộ lọc snapshot", async () => {
      const s = await h.scenario(1, 100, [8, 35]); const a = s.records[0];
      const path = `admin/evaluations/${a.evaluationId}/scores/${s.leaf1}/review`;
      assert.equal((await api("PUT", path, h.adminToken, { adminScore: 8 })).status, 200);
      assert.equal((await api("PUT", path, h.adminToken, { adminScore: 6, adminComment: "Trừ 2 điểm vì thiếu nội dung" })).status, 200);
      const score = await h.prisma.criterionScore.findUniqueOrThrow({ where: { evaluationId_criterionId: { evaluationId: a.evaluationId, criterionId: s.leaf1 } } });
      const logs = await api("GET", `admin/audit-logs?actorId=${h.adminId}&entity=CriterionScore&entityId=${score.id}&action=REVIEW_SCORE&from=2026-01-01T00%3A00%3A00Z&to=2099-01-01T00%3A00%3A00Z`);
      assert.equal(logs.body.total, 2); const entry = logs.body.items[0];
      assert.equal(entry.before.adminScore, "8"); assert.equal(entry.after.adminScore, "6"); assert.equal(entry.after.adminComment, "Trừ 2 điểm vì thiếu nội dung"); assert.equal(entry.actorId, h.adminId); assert.ok(entry.actorName); assert.ok(Date.parse(entry.createdAt));
      const detail = await api("GET", `admin/audit-logs/${entry.id}`); assert.equal(detail.cache, "no-store"); assert.deepEqual(detail.body, entry);
      assert.equal((await api("GET", `admin/audit-logs?entityId=${score.id}&action=KHONG_TON_TAI`)).body.total, 0);
    });

    await suite.test("che bí mật lồng nhau lúc ghi và đọc audit cũ, giữ thứ tự timestamp trùng", async () => {
      const entityId = randomUUID(); const timestamp = new Date(); const secret = "vc13-bi-mat-khong-duoc-lo";
      const snapshot = { password: secret, hash: secret, token: secret, secret, credentialCiphertext: secret, items: [{ privateKey: secret, nonce: secret, tag: secret, name: "Tên được giữ" }] };
      await h.audit.record({ actorId: null, action: "VC13_REDACT", entity: "Test", entityId, after: snapshot });
      const written = await h.prisma.auditLog.findFirstOrThrow({ where: { entityId } }); assert.doesNotMatch(JSON.stringify(written), new RegExp(secret));
      const ids = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
      for (const id of ids) await h.prisma.auditLog.create({ data: { id, actorId: null, action: "VC13_LEGACY", entity: "Test", entityId, before: snapshot, after: snapshot, createdAt: timestamp } });
      const first = await api("GET", `admin/audit-logs?entityId=${entityId}&action=VC13_LEGACY&actorId=SYSTEM&pageSize=2`);
      const second = await api("GET", `admin/audit-logs?entityId=${entityId}&action=VC13_LEGACY&actorId=system&pageSize=2&page=2`);
      assert.deepEqual([...first.body.items, ...second.body.items].map((item) => item.id), ids);
      assert.equal(first.body.items[0].actorName, "Hệ thống"); assert.doesNotMatch(JSON.stringify(first.body), new RegExp(secret));
      const detail = await api("GET", `admin/audit-logs/${ids[0]}`); assert.doesNotMatch(JSON.stringify(detail.body), new RegExp(secret)); assert.match(JSON.stringify(detail.body), /Tên được giữ/);
    });

    await suite.test("yêu cầu bổ sung tự sinh, job actor null và append-only SQL thật", async () => {
      const s = await h.scenario(); const a = s.records[0]; await h.supplement(s);
      const feedback = await api("GET", `evaluations/${a.evaluationId}/feedback`, a.token);
      assert.equal(feedback.body.items[0].type, "SUPPLEMENT_REQUEST");
      await h.prisma.evaluation.update({ where: { id: a.evaluationId }, data: { supplementStartAt: new Date(Date.now() - 120000), supplementDeadline: new Date(Date.now() - 60000) } });
      await h.scheduler.processPeriod(s.periodId);
      const history = await api("GET", `evaluations/${a.evaluationId}/status-history`, a.token);
      const system = history.body.items.find((item) => item.toStatus === "SUPPLEMENT_EXPIRED"); assert.ok(system); assert.equal(system.actorId, null); assert.equal(system.actorName, "Hệ thống");
      const log = await h.prisma.auditLog.findFirstOrThrow({ where: { entityId: a.evaluationId, action: "AUTO_STATUS" } }); assert.equal(log.actorId, null);
      for (const table of ["evaluation_feedbacks", "status_histories", "audit_logs"]) {
        const id = table === "evaluation_feedbacks" ? feedback.body.items[0].id : table === "status_histories" ? system.id : log.id;
        await assert.rejects(h.prisma.$executeRawUnsafe(`UPDATE ${table} SET created_at=created_at WHERE id=$1::uuid`, id));
        await assert.rejects(h.prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE id=$1::uuid`, id));
      }
      assert.equal((await api("DELETE", `evaluations/${a.evaluationId}/feedback/${feedback.body.items[0].id}`, a.token)).status, 404);
    });

    await suite.test("finalize cạnh tranh với phản hồi và khóa gửi sau chốt", async () => {
      const s = await h.scenario(); const a = s.records[0]; await h.firstReview(a.evaluationId);
      await h.prisma.evaluationPeriod.update({ where: { id: s.periodId }, data: { phase: "FINAL_REVIEW" } });
      const [finalized, sent] = await Promise.all([api("POST", `admin/evaluations/${a.evaluationId}/finalize`, h.adminToken, {}), api("POST", `evaluations/${a.evaluationId}/feedback`, a.token, { type: "UNIT_REPLY", content: "Trao đổi cạnh tranh trước chốt" })]);
      assert.equal(finalized.status, 200); assert.ok([201, 403].includes(sent.status));
      const record = await h.prisma.evaluation.findUniqueOrThrow({ where: { id: a.evaluationId } });
      if (sent.status === 201) assert.ok(Date.parse(sent.body.createdAt) <= +record.finalizedAt!);
      for (const token of [a.token, h.adminToken]) {
        const messages = await api("GET", `evaluations/${a.evaluationId}/feedback`, token); assert.equal(messages.status, 200); assert.equal(messages.body.canPost, false);
        assert.equal((await api("POST", `evaluations/${a.evaluationId}/feedback`, token, { type: token === a.token ? "UNIT_REPLY" : "GENERAL", content: "Không sửa sau chốt" })).status, 403);
        assert.equal((await api("GET", `evaluations/${a.evaluationId}/status-history`, token)).body.items[0].toStatus, "FINALIZED");
      }
    });

    await suite.test("xuất Excel thật có audit nguyên tử và worker chỉ ghi kết quả token thắng", async () => {
      const s = await h.scenario(); const exported = await api("POST", "admin/reports/exports", h.adminToken, { periodId: s.periodId, reportType: "SUMMARY_ALL_UNITS", format: "XLSX" });
      assert.equal(exported.status, 201); assert.equal(await h.prisma.auditLog.count({ where: { entityId: exported.body.id, action: "REPORT_EXPORTED", actorId: h.adminId } }), 1);
      // Audit xuất lỗi phải rollback metadata và dọn đúng tệp vừa sinh, giữ tệp thành công trước đó
      const reportDirectory = resolve(".tmp/vc13-report-exports", s.periodId); const files = await readdir(reportDirectory);
      const recordAudit = h.audit.record.bind(h.audit);
      h.audit.record = async (payload, tx) => { if (payload.action === "REPORT_EXPORTED") throw new Error("Lỗi kiểm audit báo cáo"); await recordAudit(payload, tx); };
      try { assert.equal((await api("POST", "admin/reports/exports", h.adminToken, { periodId: s.periodId, reportType: "SUMMARY_ALL_UNITS", format: "XLSX" })).status, 500); }
      finally { h.audit.record = recordAudit; }
      assert.deepEqual(await readdir(reportDirectory), files); assert.equal(await h.prisma.reportExport.count({ where: { periodId: s.periodId } }), 1);
      const notification = await h.prisma.notification.create({ data: { id: randomUUID(), userId: h.adminId, type: "VC13_WORKER", title: "Kiểm audit", body: "Nội dung kiểm thử", createdAt: new Date() } });
      const claim = { id: randomUUID(), claim_token: randomUUID() };
      // Fixture lease phải đủ ba trường theo CHECK VC03, không tắt ràng buộc để tạo token giả
      await h.prisma.notificationDelivery.create({ data: { id: claim.id, notificationId: notification.id, channel: "EMAIL", status: "PENDING", claimToken: claim.claim_token, claimedAt: new Date(), leaseUntil: new Date(Date.now() + 30000), createdAt: new Date(), updatedAt: new Date() } });
      // Worker chưa ghi được audit phải giữ lease/trạng thái để nhận lại, không kết thúc delivery mồ côi
      h.audit.record = async () => { throw new Error("Lỗi kiểm audit worker"); };
      try { await assert.rejects(h.notifications.finishClaim(claim, 0, { kind: "sent" })); }
      finally { h.audit.record = recordAudit; }
      const pending = await h.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: claim.id } }); assert.equal(pending.status, "PENDING"); assert.equal(pending.attemptCount, 0); assert.equal(pending.claimToken, claim.claim_token);
      assert.equal(await h.notifications.finishClaim(claim, 0, { kind: "skip", reasonCode: "PROVIDER_NOT_READY", message: "Không gửi thật" }), true);
      assert.equal(await h.notifications.finishClaim(claim, 0, { kind: "sent" }), false);
      const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { entityId: claim.id, action: "NOTIFICATION_DELIVERY" } }); assert.equal(audit.actorId, null);
      assert.equal(await h.prisma.auditLog.count({ where: { entityId: claim.id } }), 1);
    });
  } finally { await h.app.close(); }
});
