import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createVc12Harness, type Vc12Harness } from "./vc12-support.js";
import { lockPeriod } from "../../src/common/services/period-lock.js";
import { Prisma } from "../../src/generated/prisma/client.js";

let h: Vc12Harness;

/** Dùng chung Nest và kết nối DB thật, các test chạy tuần tự và mỗi test tạo kỳ riêng */
before(async () => { h = await createVc12Harness(); });
/** Đóng kết nối và timer khi hết bộ kiểm, không xóa fixture hoặc reset cơ sở dữ liệu */
after(async () => { await h?.app.close(); });

/** Kiểm ma trận status × phase × role bằng endpoint thật và lỗi đầu vào có dấu
 * Các trạng thái của ma trận là fixture DB riêng, lệnh chấm vẫn đi qua Auth/DTO/Prisma thật
 */
test("ma trận HTTP quyền thẩm định, validation, IDOR và projection riêng Admin", async () => {
  const s = await h.scenario(2); const r = s.records[0]; const path = `admin/evaluations/${r.evaluationId}`;
  assert.equal((await h.request("GET", `${path}/review`)).status, 401);
  assert.equal((await h.request("GET", `${path}/review`, r.token)).status, 403);
  assert.equal((await h.request("GET", `evaluations/${r.evaluationId}`, s.records[1].token)).status, 404);
  for (const phase of ["SETUP", "SELF_EVAL", "FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW", "CLOSED"]) {
    await h.prisma.evaluationPeriod.update({ where: { id: s.periodId }, data: { phase } });
    for (const status of ["DRAFT", "PENDING_REVIEW", "SUPPLEMENT_REQUESTED", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED", "FINALIZED"]) {
      await h.prisma.evaluation.update({ where: { id: r.evaluationId }, data: { status, supplementRequestedAt: new Date(), supplementStartAt: new Date(Date.now() - 1000), supplementDeadline: new Date(Date.now() + 3600000), finalizedAt: new Date(), finalizedById: h.adminId, finalScore: 0, finalPercent: 0, finalRating: "FAIL" } });
      const allowed = ["FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW"].includes(phase) && ["PENDING_REVIEW", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"].includes(status);
      const result = await h.request("PUT", `${path}/scores/${s.leaf1}/review`, h.adminToken, { adminScore: 49, adminComment: "Minh chứng chưa đầy đủ" });
      assert.equal(result.status, allowed ? 200 : 403, `${phase}/${status}`);
      assert.equal((await h.request("PUT", `${path}/scores/${s.leaf1}/review`, r.token, { adminScore: 49, adminComment: "Không có quyền" })).status, 403);
    }
  }
  await h.prisma.evaluationPeriod.update({ where: { id: s.periodId }, data: { phase: "FIRST_REVIEW" } });
  await h.prisma.evaluation.update({ where: { id: r.evaluationId }, data: { status: "PENDING_REVIEW" } });
  for (const body of [{ adminScore: -1 }, { adminScore: 1.001 }, { adminScore: "1" }, { adminScore: null }, { adminScore: 1, reviewedById: randomUUID() }]) assert.equal((await h.request("PUT", `${path}/scores/${s.leaf1}/review`, h.adminToken, body)).status, 400);
  assert.equal((await h.request("PUT", `${path}/scores/${s.leaf1}/review`, h.adminToken, { adminScore: 49, adminComment: "   " })).status, 422);
  assert.equal((await h.request("PUT", `${path}/scores/${s.parentId}/review`, h.adminToken, { adminScore: 1, adminComment: "Nhóm không có điểm" })).status, 404);
  assert.equal((await h.request("PUT", `${path}/scores/${s.leaf1}/review`, h.adminToken, { adminScore: 61, adminComment: "Vượt điểm" })).status, 422);
  const detail = await h.request("GET", `${path}/review`, h.adminToken);
  assert.equal(detail.status, 200); assert.equal(detail.body.criteria[0].children.length, 2);
  assert.equal(detail.body.criteria[0].children[0].reviewedById, h.adminId);
  assert.equal(JSON.stringify((await h.request("GET", `evaluations/${r.evaluationId}`, r.token)).body).includes("adminComment"), false);
});

/** Thử lỗi audit trong transaction yêu cầu để chứng minh baseline, phase và outbox cùng rollback
 * Hai request cùng payload sau đó chỉ tạo một vòng, payload khác bị chặn thay vì kéo dài lịch
 */
test("yêu cầu bổ sung nguyên tử, cạnh tranh, một vòng và lịch thứ Sáu", async () => {
  const s = await h.scenario(2); const r = s.records[0]; const path = `admin/evaluations/${r.evaluationId}`;
  await h.firstReview(r.evaluationId);
  const start = h.futureWeekday(6);
  const body = { supplementStartAt: start, supplementDeadline: new Date(Date.parse(start) + 90 * 60000).toISOString(), items: [{ criterionId: s.leaf1, note: "Bổ sung báo cáo riêng mục A" }] };
  const originalAudit = h.audit.record.bind(h.audit);
  h.audit.record = async (input, tx) => { if (input.action === "SUPPLEMENT_REQUEST") throw new Error("Lỗi audit được chủ động tạo để kiểm rollback"); return originalAudit(input, tx); };
  try { assert.equal((await h.request("POST", `${path}/supplement-request`, h.adminToken, body)).status, 500); }
  finally { h.audit.record = originalAudit; }
  assert.equal((await h.prisma.evaluationPeriod.findUniqueOrThrow({ where: { id: s.periodId } })).phase, "FIRST_REVIEW");
  assert.equal((await h.prisma.evaluation.findUniqueOrThrow({ where: { id: r.evaluationId } })).supplementRequestedAt, null);
  assert.equal(await h.prisma.criterionScore.count({ where: { evaluationId: r.evaluationId, needsSupplement: true } }), 0);
  assert.equal(await h.prisma.evaluationFeedback.count({ where: { evaluationId: r.evaluationId } }), 0);
  assert.equal(await h.prisma.notification.count({ where: { refId: r.evaluationId, type: "SUPPLEMENT_REQUESTED" } }), 0);
  const race = await Promise.all([h.request("POST", `${path}/supplement-request`, h.adminToken, body), h.request("POST", `${path}/supplement-request`, h.adminToken, body)]);
  assert.deepEqual(race.map((item) => item.status), [200, 200]);
  assert.equal(race[0].body.supplementDeadline, race[1].body.supplementDeadline);
  assert.equal(race[0].body.supplementDeadline, body.supplementDeadline);
  assert.equal((await h.prisma.evaluationPeriod.findUniqueOrThrow({ where: { id: s.periodId } })).phase, "SUPPLEMENT");
  assert.equal(await h.prisma.statusHistory.count({ where: { evaluationId: r.evaluationId, toStatus: "SUPPLEMENT_REQUESTED" } }), 1);
  assert.equal(await h.prisma.evaluationFeedback.count({ where: { evaluationId: r.evaluationId, type: "SUPPLEMENT_REQUEST" } }), 1);
  const notice = await h.prisma.notification.findFirstOrThrow({ where: { refId: r.evaluationId, type: "SUPPLEMENT_REQUESTED", userId: r.userId }, include: { deliveries: true } });
  assert.equal(notice.deliveries.some((item) => item.channel === "ZALO_ZNS"), false);
  assert.ok(notice.deliveries.length > 0);
  assert.equal((await h.request("POST", `${path}/supplement-request`, h.adminToken, { ...body, items: [{ criterionId: s.leaf2, note: "Vòng thứ hai" }] })).body.code, "SUPPLEMENT_ALREADY_REQUESTED");
  assert.equal((await h.request("POST", `evaluations/${r.evaluationId}/supplement-submit`, r.token, {})).status, 403);
  assert.equal((await h.request("PUT", `evaluations/${r.evaluationId}/scores/${s.leaf1}/self`, r.token, { selfNote: "Chưa mở" })).status, 403);
  // Phase SUPPLEMENT vẫn cho thẩm định hồ sơ khác đã sẵn sàng
  assert.equal((await h.request("PUT", `admin/evaluations/${s.records[1].evaluationId}/scores/${s.leaf1}/review`, h.adminToken, { adminScore: 50 })).status, 200);
});

/** Kiểm nội dung cuối khác baseline qua điểm, diễn giải và file/link xác nhận thật
 * Không tính reservation, cờ hoặc các thao tác đã hoàn tác; bảo vệ INITIAL và quyền UNIT khác
 */
test("baseline loại trừ hoàn tác, minh chứng bổ sung và nộp đủ từng mục", async () => {
  const s = await h.scenario(2); const r = s.records[0]; const path = `evaluations/${r.evaluationId}`;
  await h.supplement(s, 0, true);
  assert.equal((await h.request("POST", `${path}/supplement-submit`, r.token, {})).body.code, "INCOMPLETE_SUPPLEMENT");
  await h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfScore: 49 });
  await h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfScore: 50 });
  await h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfNote: "Diễn giải mới" });
  await h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfNote: "Nội dung ban đầu" });
  const initial = await h.prisma.evidence.findFirstOrThrow({ where: { criterionScore: { evaluationId: r.evaluationId }, round: "INITIAL" } });
  assert.equal((await h.request("DELETE", `${path}/evidences/${initial.id}`, r.token)).status, 403);
  const added = await h.request("POST", `${path}/evidences`, r.token, { items: [{ kind: "LINK", criterionId: s.leaf1, externalUrl: "https://example.com/bao-cao-bo-sung" }] });
  assert.equal(added.body.results[0].ok, true);
  assert.equal((await h.request("DELETE", `${path}/evidences/${added.body.results[0].data.id}`, r.token)).status, 200);
  assert.equal((await h.request("POST", `${path}/supplement-submit`, r.token, {})).body.code, "INCOMPLETE_SUPPLEMENT");
  const bytes = Buffer.from("%PDF-1.4\nMinh chứng kiểm thử VC12\n%%EOF");
  const reservation = await h.request("POST", `${path}/evidences/upload-urls`, r.token, { items: [{ criterionId: s.leaf1, fileName: "Bao-cao.pdf", mimeType: "application/pdf", sizeBytes: bytes.length }] });
  assert.equal(reservation.body.results[0].ok, true); const upload = reservation.body.results[0].data;
  assert.equal((await h.request("POST", `${path}/supplement-submit`, r.token, {})).body.code, "INCOMPLETE_SUPPLEMENT");
  assert.equal((await fetch(`${h.base}${upload.uploadUrl}`, { method: "PUT", headers: { "content-type": "application/pdf" }, body: bytes })).status, 200);
  const confirmed = await h.request("POST", `${path}/evidences`, r.token, { items: [{ kind: "FILE", criterionId: s.leaf1, uploadId: upload.uploadId }] });
  assert.equal(confirmed.body.results[0].ok, true);
  assert.equal((await h.request("POST", `${path}/supplement-submit`, r.token, {})).body.code, "INCOMPLETE_SUPPLEMENT");
  assert.equal((await h.request("PUT", `${path}/scores/${s.leaf2}/self`, r.token, { selfNote: "Đã bổ sung mục B" })).status, 200);
  const changed = await h.request("GET", `admin/evaluations/${r.evaluationId}/review`, h.adminToken);
  assert.ok(changed.body.criteria[0].children.every((item) => item.supplementChanged && item.adminScore === null));
  assert.equal(changed.body.criteria[0].children[0].supplementBaseline?.review.adminScore, "50");
  assert.equal(JSON.stringify((await h.request("GET", path, r.token)).body).includes("supplementBaseline"), false);
  assert.equal((await h.request("POST", `${path}/supplement-submit`, s.records[1].token, {})).status, 404);
  assert.equal((await h.request("POST", `${path}/supplement-submit`, r.token, {})).status, 200);
  assert.equal((await h.request("POST", `${path}/supplement-submit`, r.token, {})).status, 200);
  assert.equal(await h.prisma.statusHistory.count({ where: { evaluationId: r.evaluationId, toStatus: "SUPPLEMENT_SUBMITTED" } }), 1);
  assert.equal((await h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfScore: 48 })).status, 403);
  assert.equal((await h.request("DELETE", `${path}/evidences/${confirmed.body.results[0].data.id}`, r.token)).status, 403);
});

/** Cố tình trả giờ service ngay trước hạn trong khi statement DB đã quá hạn để kiểm lớp bảo vệ cuối
 * Không mock Prisma hoặc đổi giờ hệ thống; chỉ fault-inject khoảng cách kiểm và ghi thực tế
 * Sau khi khôi phục Clock DB, API reconcile hết hạn đúng một lần và không tự chốt
 */
test("statement DB chặn điểm, file và nộp sát hạn dù lần kiểm service còn quyền", async () => {
  const s = await h.scenario(); const r = s.records[0]; const path = `evaluations/${r.evaluationId}`;
  await h.supplement(s);
  await h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfNote: "Đã bổ sung" });
  const bytes = Buffer.from("%PDF-1.4\nTệp thử sát hạn\n%%EOF");
  const issued = await h.request("POST", `${path}/evidences/upload-urls`, r.token, { items: [{ criterionId: s.leaf1, fileName: "Sat-han.pdf", mimeType: "application/pdf", sizeBytes: bytes.length }] });
  const upload = issued.body.results[0].data;
  const deadline = new Date(Date.now() - 1000);
  await h.prisma.evaluation.update({ where: { id: r.evaluationId }, data: { supplementDeadline: deadline } });
  const originalNow = h.state.databaseNow.bind(h.state);
  h.state.databaseNow = async () => new Date(+deadline - 1);
  try {
    const score = await h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfScore: 48 });
    assert.equal(score.status, 403, JSON.stringify(score.body)); assert.equal(score.body.code, "DEADLINE_PASSED");
    const link = await h.request("POST", `${path}/evidences`, r.token, { items: [{ kind: "LINK", criterionId: s.leaf1, externalUrl: "https://example.com/qua-han" }] });
    assert.equal(link.body.results[0].error.code, "DEADLINE_PASSED");
    const submit = await h.request("POST", `${path}/supplement-submit`, r.token, {});
    assert.equal(submit.status, 403, JSON.stringify(submit.body)); assert.equal(submit.body.code, "DEADLINE_PASSED");
  } finally { h.state.databaseNow = originalNow; }
  const lateUpload = await fetch(`${h.base}${upload.uploadUrl}`, { method: "PUT", headers: { "content-type": "application/pdf" }, body: bytes });
  assert.equal(lateUpload.status, 403); assert.equal((await lateUpload.json() as { code: string }).code, "DEADLINE_PASSED");
  assert.equal((await h.request("GET", `admin/evaluations/${r.evaluationId}/review`, h.adminToken)).body.status, "SUPPLEMENT_EXPIRED");
  assert.equal(await h.prisma.statusHistory.count({ where: { evaluationId: r.evaluationId, toStatus: "SUPPLEMENT_EXPIRED" } }), 1);
  assert.equal((await h.request("POST", `${path}/supplement-submit`, r.token, {})).body.code, "DEADLINE_PASSED");
});

/** Làm chậm kho local thật để upload bắt đầu còn hạn nhưng kết thúc I/O sau hạn
 * Response không được báo thành công, bytes vùng chờ không trở thành Evidence và reservation còn để cleanup
 */
test("upload kiểm lại deadline sau I/O và không xác nhận tệp vượt hạn", async () => {
  const s = await h.scenario(); const r = s.records[0]; await h.supplement(s);
  const bytes = Buffer.from("%PDF-1.4\nKho local có độ trễ kiểm thử\n%%EOF");
  const issued = await h.request("POST", `evaluations/${r.evaluationId}/evidences/upload-urls`, r.token, { items: [{ criterionId: s.leaf1, fileName: "Kho-cham.pdf", mimeType: "application/pdf", sizeBytes: bytes.length }] });
  const upload = issued.body.results[0].data;
  const originalPut = h.storage.put.bind(h.storage); let wrote = false;
  h.storage.put = async (...args) => { await originalPut(...args); wrote = true; await new Promise((resolve) => setTimeout(resolve, 4000)); };
  await h.prisma.evaluation.update({ where: { id: r.evaluationId }, data: { supplementDeadline: new Date(Date.now() + 3000) } });
  try {
    const response = await fetch(`${h.base}${upload.uploadUrl}`, { method: "PUT", headers: { "content-type": "application/pdf" }, body: bytes });
    assert.equal(response.status, 403); assert.equal((await response.json() as { code: string }).code, "DEADLINE_PASSED");
    assert.equal(wrote, true);
  } finally { h.storage.put = originalPut; }
  assert.equal(await h.prisma.evidence.count({ where: { criterionScore: { evaluationId: r.evaluationId }, round: "SUPPLEMENT" } }), 0);
  assert.equal((await h.prisma.evidenceUpload.findUniqueOrThrow({ where: { id: upload.uploadId } })).state, "PENDING");
});

/** Chạy lưu và nộp cạnh tranh khi còn cửa sổ, kết quả phải tuần tự theo khóa hồ sơ
 * Nộp thành công đúng một lần, lệnh lưu sau nộp bị chặn và không làm thay đổi nội dung đã khóa
 */
test("race lưu và nộp bổ sung không ghi xuyên trạng thái đã khóa", async () => {
  const s = await h.scenario(); const r = s.records[0]; const path = `evaluations/${r.evaluationId}`;
  await h.supplement(s);
  await h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfNote: "Bổ sung trước cạnh tranh" });
  const results = await Promise.all([h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfNote: "Bổ sung trong cạnh tranh" }), h.request("POST", `${path}/supplement-submit`, r.token, {})]);
  assert.equal(results[1].status, 200); assert.ok([200, 403].includes(results[0].status));
  const score = await h.prisma.criterionScore.findUniqueOrThrow({ where: { evaluationId_criterionId: { evaluationId: r.evaluationId, criterionId: s.leaf1 } } });
  assert.equal(score.selfNote, results[0].status === 200 ? "Bổ sung trong cạnh tranh" : "Bổ sung trước cạnh tranh");
  assert.equal(await h.prisma.statusHistory.count({ where: { evaluationId: r.evaluationId, toStatus: "SUPPLEMENT_SUBMITTED" } }), 1);
});

/** Giữ khóa kỳ qua deadline rồi cho API và scheduler cùng tranh, giờ phải được lấy lại sau khóa
 * Các lệnh tới trước hạn không được giữ quyền qua hạn và chỉ một history expiry được commit
 */
test("race chờ khóa qua deadline giữa lưu, nộp và scheduler", async () => {
  const s = await h.scenario(); const r = s.records[0]; const path = `evaluations/${r.evaluationId}`;
  await h.supplement(s);
  let locked!: () => void; const ready = new Promise<void>((resolve) => { locked = resolve; });
  const holder = h.prisma.$transaction(async (tx) => {
    await lockPeriod(tx, s.periodId);
    await tx.evaluation.update({ where: { id: r.evaluationId }, data: { supplementDeadline: new Date(Date.now() + 300) } });
    locked(); await tx.$queryRaw`SELECT 1 AS waited FROM pg_sleep(0.6)`;
  });
  await ready;
  const work = Promise.all([h.request("PUT", `${path}/scores/${s.leaf1}/self`, r.token, { selfNote: "Không được lưu sau hạn" }), h.request("POST", `${path}/supplement-submit`, r.token, {}), h.scheduler.run()]);
  await holder; const results = await work;
  assert.equal(results[0].status, 403); assert.equal(results[0].body.code, "DEADLINE_PASSED");
  assert.equal(results[1].status, 403); assert.equal(results[1].body.code, "DEADLINE_PASSED");
  assert.equal((await h.prisma.evaluation.findUniqueOrThrow({ where: { id: r.evaluationId } })).status, "SUPPLEMENT_EXPIRED");
  assert.equal(await h.prisma.statusHistory.count({ where: { evaluationId: r.evaluationId, toStatus: "SUPPLEMENT_EXPIRED" } }), 1);
  assert.equal(await h.prisma.statusHistory.count({ where: { evaluationId: r.evaluationId, toStatus: "FINALIZED" } }), 0);
});

/** Kiểm đồ thị thật khi một hồ sơ đang bổ sung và hồ sơ khác đã sẵn sàng
 * Đóng kỳ bị chặn tới khi mọi hồ sơ chốt, expiry được đồng bộ trong chuyển phase không tự chốt
 */
test("phase SUPPLEMENT vẫn thẩm định hồ sơ sẵn sàng và CLOSED đợi mọi kết quả", async () => {
  const s = await h.scenario(2); const [one, two] = s.records;
  await h.supplement(s); await h.firstReview(two.evaluationId);
  assert.equal((await h.request("POST", `evaluation-periods/${s.periodId}/transition-phase`, h.adminToken, { phase: "FINAL_REVIEW" })).status, 400);
  await h.prisma.evaluation.update({ where: { id: one.evaluationId }, data: { supplementDeadline: new Date(Date.now() - 1) } });
  assert.equal((await h.request("POST", `evaluation-periods/${s.periodId}/transition-phase`, h.adminToken, { phase: "FINAL_REVIEW" })).status, 200);
  assert.equal((await h.prisma.evaluation.findUniqueOrThrow({ where: { id: one.evaluationId } })).status, "SUPPLEMENT_EXPIRED");
  assert.equal((await h.request("POST", `evaluation-periods/${s.periodId}/transition-phase`, h.adminToken, { phase: "CLOSED" })).status, 400);
  const finals = await h.request("POST", "admin/evaluations/finalize-batch", h.adminToken, { evaluationIds: [one.evaluationId, randomUUID(), two.evaluationId] });
  assert.deepEqual(finals.body.results.map((item) => item.ok), [true, false, true]);
  assert.equal((await h.request("POST", `evaluation-periods/${s.periodId}/transition-phase`, h.adminToken, { phase: "CLOSED" })).status, 200);
  assert.equal((await h.request("POST", `evaluation-periods/${s.periodId}/transition-phase`, h.adminToken, { phase: "FIRST_REVIEW" })).status, 400);
});

/** Tiêm lỗi thông báo sau ghi kết quả để chứng minh rollback trọn vẹn, sau đó chốt cạnh tranh thật
 * Phần trăm chia cho 3 có nhiều chữ số, snapshot lưu phải khớp view mà không làm tròn trước phân loại
 */
test("finalize rollback, độ chính xác Decimal, preview và hai lệnh chốt cạnh tranh", async () => {
  const s = await h.scenario(1, 3, [2.56, 0]); const r = s.records[0];
  await h.firstReview(r.evaluationId);
  assert.equal((await h.request("POST", `evaluation-periods/${s.periodId}/transition-phase`, h.adminToken, { phase: "FINAL_REVIEW" })).status, 200);
  const originalNotice = h.notifications.notifyUser.bind(h.notifications);
  h.notifications.notifyUser = async (tx, input) => { if (input.type === "EVALUATION_FINALIZED") throw new Error("Lỗi thông báo được chủ động tạo để kiểm rollback"); return originalNotice(tx, input); };
  try { assert.equal((await h.request("POST", `admin/evaluations/${r.evaluationId}/finalize`, h.adminToken, {})).status, 500); }
  finally { h.notifications.notifyUser = originalNotice; }
  const rolled = await h.prisma.evaluation.findUniqueOrThrow({ where: { id: r.evaluationId } });
  assert.equal(rolled.status, "PENDING_REVIEW"); assert.equal(rolled.finalScore, null);
  assert.equal(await h.prisma.statusHistory.count({ where: { evaluationId: r.evaluationId, toStatus: "FINALIZED" } }), 0);
  assert.equal(await h.prisma.auditLog.count({ where: { entityId: r.evaluationId, action: "FINALIZE" } }), 0);
  assert.equal(await h.prisma.notification.count({ where: { refId: r.evaluationId, type: "EVALUATION_FINALIZED" } }), 0);
  const preview = await h.request("POST", "admin/evaluations/finalize-preview", h.adminToken, { evaluationIds: [r.evaluationId] });
  assert.equal(preview.body.results[0].data.rating, "EXCELLENT");
  const race = await Promise.all([h.request("POST", `admin/evaluations/${r.evaluationId}/finalize`, h.adminToken, {}), h.request("POST", `admin/evaluations/${r.evaluationId}/finalize`, h.adminToken, {})]);
  assert.deepEqual(race.map((item) => item.status).sort(), [200, 403]);
  const final = await h.prisma.evaluation.findUniqueOrThrow({ where: { id: r.evaluationId } });
  const [view] = await h.prisma.$queryRaw<{ current_total: Prisma.Decimal; current_percent: Prisma.Decimal; suggested_rating: string }[]>`SELECT current_total, current_percent, suggested_rating FROM v_evaluation_totals WHERE evaluation_id = ${r.evaluationId}::uuid`;
  assert.ok(final.finalScore?.eq(view.current_total)); assert.ok(final.finalPercent?.eq(view.current_percent));
  assert.equal(final.finalRating, view.suggested_rating); assert.ok(final.finalPercent!.decimalPlaces() > 2);
  assert.equal(await h.prisma.statusHistory.count({ where: { evaluationId: r.evaluationId, toStatus: "FINALIZED" } }), 1);
  assert.equal((await h.request("POST", "admin/evaluations/finalize-preview", r.token, { evaluationIds: [r.evaluationId] })).status, 403);
});

/** Mô phỏng điểm thay đổi hợp lệ giữa preview và chốt để nhãn FE không giữ kết quả cũ
 * Cùng endpoint thẩm định được dùng ở FINAL_REVIEW, lệnh chốt phải tính lại tổng và nhãn của kỳ
 */
test("chốt trả nhãn xếp loại thực tế khi điểm thay đổi sau preview", async () => {
  const s = await h.scenario(); const r = s.records[0];
  await h.firstReview(r.evaluationId);
  assert.equal((await h.request("POST", `evaluation-periods/${s.periodId}/transition-phase`, h.adminToken, { phase: "FINAL_REVIEW" })).status, 200);
  const preview = await h.request("POST", "admin/evaluations/finalize-preview", h.adminToken, { evaluationIds: [r.evaluationId] });
  assert.equal(preview.body.results[0].data.rating, "GOOD");
  assert.equal((await h.request("PUT", `admin/evaluations/${r.evaluationId}/scores/${s.leaf1}/review`, h.adminToken, { adminScore: 55, adminComment: "Đã đối chiếu thêm minh chứng trước khi chốt" })).status, 200);
  const final = await h.request("POST", `admin/evaluations/${r.evaluationId}/finalize`, h.adminToken, {});
  assert.equal(final.status, 200); assert.equal(final.body.finalRatingLabel, "Xuất sắc");
  assert.equal((await h.prisma.evaluation.findUniqueOrThrow({ where: { id: r.evaluationId } })).finalRating, "EXCELLENT");
});
