import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import JSZip from "jszip";
import { Document, Packer, Paragraph } from "docx";
import PDFDocument from "pdfkit";
import { NestFactory } from "@nestjs/core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";
import type { EvidencesService as EvidencesServiceType } from "../../src/modules/evidences/evidences.service.js";
import type { StorageProvider as StorageProviderType } from "../../src/modules/evidences/storage.provider.js";
import type { AuditService as AuditServiceType } from "../../src/common/services/audit.service.js";

/** Chỉ mô tả trường API công khai để kiểm schema trả về, không dùng model nội bộ làm response */
interface Payload {
  id: string; uploadId: string; uploadUrl: string; downloadUrl: string; url: string; accessToken: string;
  mimeType: string; fileName: string; expiresAt: string; message: string; code: string; round: string;
  previewStatus: string; ok: boolean; canDelete: boolean; data: Payload; error: Payload;
  requiredHeaders: Record<string, string>; results: Payload[]; criteria: Payload[]; children: Payload[]; evidences: Payload[];
}

/** Tạo PDF thật bằng generator đang dùng trong dự án, giữ fixture hợp lệ cho browser preview */
async function makePdf(): Promise<Buffer> {
  const document = new PDFDocument(); const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { document.on("data", (chunk: Buffer) => chunks.push(chunk)); document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  document.text("VC10 - Minh chung PDF"); document.end(); return result;
}

/** Kiểm HTTP Nest, PostgreSQL và bytes trên filesystem thật trong môi trường cô lập
 * Từ chối DB khác vc10_test, provider thông báo tắt hoàn toàn, không gửi ra người thật
 * Fixture bổ sung là đầu ra giả lập của VC12 để kiểm consumer VC10, không nghiệm thu API VC12
 */
test("VC10 upload nhiều minh chứng, quyền, quota, bù lỗi và preview qua backend thật", async () => {
  const url = process.env.VC10_TEST_DATABASE_URL;
  assert.ok(url && new URL(url).pathname === "/vc10_test", "Cần database vc10_test riêng để kiểm thử");
  const root = await mkdtemp(join(tmpdir(), "vc10-integration-"));
  Object.assign(process.env, { DATABASE_URL: url, JWT_SECRET: "vc10-test-secret-only-at-least-32-characters", NODE_ENV: "test", WEB_ORIGINS: "http://127.0.0.1:5180", PUBLIC_APP_URL: "http://127.0.0.1:5180", INITIAL_ACCOUNT_PASSWORD: "123456", EMAIL_ENABLED: "false", WEB_PUSH_ENABLED: "false", ZALO_ZNS_ENABLED: "false", STORAGE_ENABLED: "true", STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: root });
  const dist = new URL("../../dist/", import.meta.url);
  const { AppModule } = await import(new URL("app.module.js", dist).href);
  const { PrismaService } = await import(new URL("prisma/prisma.service.js", dist).href);
  const { EvidencesService } = await import(new URL("modules/evidences/evidences.service.js", dist).href);
  const { StorageProvider } = await import(new URL("modules/evidences/storage.provider.js", dist).href);
  const { AuditService } = await import(new URL("common/services/audit.service.js", dist).href);
  const { AllExceptionsFilter } = await import(new URL("common/filters/all-exceptions.filter.js", dist).href);
  const { createApiValidationPipe } = await import(new URL("common/pipes/api-validation.pipe.js", dist).href);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter()); app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  const prisma = app.get<PrismaServiceType>(PrismaService);
  const service = app.get<EvidencesServiceType>(EvidencesService);
  const storage = app.get<StorageProviderType>(StorageProvider);
  const audit = app.get<AuditServiceType>(AuditService);
  const base = await app.getUrl();

  /** Gửi JSON thật và giữ cả status/body để assertion phát hiện lỗi giao ước thay vì nuốt lỗi */
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as Payload };
  }

  /** Tải bytes nguyên bản bằng capability, không gắn JWT để kiểm đúng cổng storage */
  async function put(grant: Payload, bytes: Buffer, changedUrl?: string) {
    const response = await fetch(`${base}${changedUrl ?? grant.uploadUrl}`, { method: "PUT", headers: grant.requiredHeaders, body: new Uint8Array(bytes) });
    return { status: response.status, body: await response.json() as Payload };
  }

  try {
    const now = new Date(); const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID(); const userId = randomUUID(); const otherId = randomUUID();
    const unitId = randomUUID(); const otherUnitId = randomUUID(); const periodId = randomUUID();
    const parent = randomUUID(); const leaf = randomUUID(); const otherLeaf = randomUUID();
    const passwordHash = await bcrypt.hash("Vc10Test2026x", 4);
    await prisma.unit.createMany({ data: [unitId, otherUnitId].map((id, index) => ({ id, code: `VC10-${suffix}-${index}`, name: `Đơn vị minh chứng ${index}`, createdAt: now, updatedAt: now })) });
    await prisma.user.createMany({ data: [
      { id: adminId, username: `vc10-admin-${suffix}`, role: "ADMIN", unitId: null },
      { id: userId, username: `vc10-unit-${suffix}`, role: "UNIT", unitId },
      { id: otherId, username: `vc10-other-${suffix}`, role: "UNIT", unitId: otherUnitId },
    ].map((item) => ({ ...item, fullName: "Tài khoản kiểm thử VC10", passwordHash, mustChangePassword: false, createdAt: now, updatedAt: now })) });
    /** Đăng nhập tài khoản fixture qua Auth thật, không tự ký JWT để bỏ qua guard */
    const login = async (username: string) => (await request("POST", "auth/login", undefined, { username, password: "Vc10Test2026x" })).body.accessToken;
    const admin = await login(`vc10-admin-${suffix}`); const unit = await login(`vc10-unit-${suffix}`); const other = await login(`vc10-other-${suffix}`);
    assert.ok(admin && unit && other);
    const max = await prisma.evaluationPeriod.aggregate({ _max: { year: true } });
    await prisma.evaluationPeriod.create({ data: { id: periodId, year: Math.max(2050, (max._max.year ?? 2049) + 1), name: `VC10 minh chứng ${suffix}`, maxTotalScore: 100, phase: "SELF_EVAL", publishedAt: now, selfEvalStart: new Date(+now + 60000), selfEvalDeadline: new Date(+now + 86400000), createdById: adminId, createdAt: now, updatedAt: now } });
    await prisma.criterion.createMany({ data: [
      { id: parent, code: "A", name: "Nhóm minh chứng", maxScore: 100, parentId: null },
      { id: leaf, code: "A.1", name: "Minh chứng hoạt động", maxScore: 70, parentId: parent },
      { id: otherLeaf, code: "A.2", name: "Tiêu chí chỉ diễn giải", maxScore: 30, parentId: parent, allowFile: false, allowLink: false },
    ].map((item, index) => ({ ...item, periodId, sortOrder: index, createdAt: now, updatedAt: now })) });
    const id = randomUUID(); const scoreId = randomUUID(); const path = `evaluations/${id}/evidences`;
    await prisma.evaluation.create({ data: { id, periodId, unitId, createdAt: now, updatedAt: now } });
    await prisma.criterionScore.createMany({ data: [leaf, otherLeaf].map((criterionId) => ({ id: criterionId === leaf ? scoreId : randomUUID(), evaluationId: id, criterionId, createdAt: now, updatedAt: now })) });
    const pdf = await makePdf();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64");
    const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Minh chứng Word thật")] }] }));

    /** Xin một reservation để các nhánh kiểm dùng cùng metadata hợp lệ */
    async function reserve(bytes = pdf, fileName = "Báo cáo.pdf", mimeType = "application/pdf", token = unit, criterionId = leaf) {
      return (await request("POST", `${path}/upload-urls`, token, { items: [{ criterionId, fileName, mimeType, sizeBytes: bytes.length }] })).body.results[0];
    }
    /** Xác nhận một phiên hoặc link, trả kết quả từng item đúng như giao diện tiêu thụ */
    async function confirm(uploadId: string, token = unit, criterionId = leaf) {
      return (await request("POST", path, token, { items: [{ kind: "FILE", criterionId, uploadId }] })).body.results[0];
    }

    // Kiểm giờ mở, role, sở hữu và whitelist trước mọi thao tác storage thật
    assert.equal((await reserve()).error.code, "EVALUATION_LOCKED");
    assert.equal((await request("POST", `${path}/upload-urls`, admin, { items: [{ criterionId: leaf, fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 }] })).status, 403);
    assert.equal((await reserve(pdf, "x.pdf", "application/pdf", other)).error.code, "NOT_FOUND");
    assert.equal((await request("POST", path, unit, { items: [{ kind: "FILE", criterionId: leaf, uploadId: randomUUID(), round: "INITIAL" }] })).status, 400);
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { selfEvalStart: new Date(+now - 60000) } });
    assert.equal((await reserve(pdf, "x.pdf", "application/pdf", unit, otherLeaf)).ok, false);
    assert.equal((await reserve(pdf, "../x.pdf")).error.code, "INVALID_FILE");
    assert.equal((await reserve(pdf, "x.pdf", "image/png")).error.code, "INVALID_FILE");
    assert.equal((await request("POST", `${path}/upload-urls`, unit, { items: [{ criterionId: leaf, fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10485761 }] })).status, 400);
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
    assert.equal((await request("POST", path, unit, { items: [{ kind: "LINK", criterionId: leaf, externalUrl: "https://example.org" }] })).status, 403);
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: false } });

    // Bytes giả, kích thước sai và chữ ký URL sửa đều không tạo minh chứng
    const invalid = (await reserve()).data;
    assert.equal((await put(invalid, Buffer.alloc(pdf.length))).status, 422);
    assert.equal((await put(invalid, pdf.subarray(0, 10))).status, 422);
    assert.equal((await put(invalid, pdf, invalid.uploadUrl.replace(/token=[^&]+/, "token=0.sai"))).status, 403);
    assert.equal((await confirm(invalid.uploadId)).error.code, "UPLOAD_NOT_FOUND");
    await request("DELETE", `${path}/uploads/${invalid.uploadId}`, unit);

    // Mỗi tệp được upload và xác nhận độc lập, FILE retry không tạo thêm Evidence/audit
    const evidenceIds: string[] = [];
    for (const [bytes, name, mime] of [[pdf, "Báo cáo.pdf", "application/pdf"], [png, "Hoạt động.png", "image/png"], [docx, "Biên bản.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]] as const) {
      const grant = (await reserve(bytes, name, mime)).data;
      assert.equal((await put(grant, bytes)).status, 200);
      const result = await confirm(grant.uploadId); assert.equal(result.ok, true, JSON.stringify(result));
      evidenceIds.push(result.data.id);
      assert.equal(result.data.round, "INITIAL"); assert.equal(result.data.canDelete, true);
      assert.equal((await confirm(grant.uploadId)).data.id, result.data.id);
      assert.equal((await put(grant, bytes)).status, 422);
      assert.equal(await prisma.auditLog.count({ where: { entityId: result.data.id, action: "CREATE" } }), 1);
    }
    const download = await request("GET", `${path}/${evidenceIds[0]}`, admin);
    assert.equal(download.status, 200); assert.ok(download.body.downloadUrl);
    assert.equal(/storagePath|pendingPath|finalPath|uploaderId|credentialVersion/.test(JSON.stringify(download.body)), false);
    const fetched = await fetch(`${base}${download.body.downloadUrl}`); assert.equal(fetched.status, 200); assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), pdf);
    assert.match(fetched.headers.get("content-disposition")!, /attachment/); assert.equal(fetched.headers.get("cache-control"), "no-store");
    const preview = await request("GET", `${path}/${evidenceIds[1]}/preview`, unit);
    assert.equal((await fetch(`${base}${preview.body.url}`)).status, 200);
    const wordDownload = await request("GET", `${path}/${evidenceIds[2]}`, unit);
    const wordResponse = await fetch(`${base}${wordDownload.body.downloadUrl}`);
    assert.deepEqual(Buffer.from(await wordResponse.arrayBuffer()), docx);
    assert.equal((await request("GET", `${path}/${evidenceIds[2]}/preview`, unit)).body.code, "PREVIEW_NOT_AVAILABLE");
    assert.equal((await request("GET", `${path}/${evidenceIds[0]}`, other)).status, 404);
    assert.equal((await request("GET", `${path}/${randomUUID()}`, unit)).status, 404);
    assert.equal((await fetch(`${base}/api/v1/storage/files/${evidenceIds[0]}?operation=download`)).status, 403);
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { selfEvalStart: new Date(Date.now() + 60000) } });
    assert.equal((await request("GET", `${path}/${evidenceIds[0]}`, unit)).status, 403);
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { selfEvalStart: new Date(+now - 60000) } });

    // LINK không fetch và batch có kết quả riêng, giao thức javascript bị chặn trước ghi
    const mixed = await request("POST", path, unit, { items: [{ kind: "LINK", criterionId: leaf, externalUrl: "https://example.org/minh-chung", description: "Bài viết" }, { kind: "LINK", criterionId: leaf, externalUrl: "javascript:alert(1)" }] });
    assert.equal(mixed.body.results[0].ok, true); assert.equal(mixed.body.results[1].error.code, "INVALID_LINK");

    // Đặt lỗi audit sau copy final, DB rollback còn reservation để retry/dọn bù
    const rollback = (await reserve()).data; await put(rollback, pdf);
    const record = audit.record.bind(audit);
    audit.record = async () => { throw new Error("Lỗi audit phục vụ kiểm bù object"); };
    try { assert.equal((await confirm(rollback.uploadId)).error.code, "INTERNAL_ERROR"); }
    finally { audit.record = record; }
    assert.equal(await prisma.evidence.count({ where: { id: rollback.uploadId } }), 0);
    const orphan = await prisma.evidenceUpload.findUniqueOrThrow({ where: { id: rollback.uploadId } });
    assert.equal(orphan.state, "PENDING"); assert.ok(await storage.get(orphan.finalPath));
    await request("DELETE", `${path}/uploads/${rollback.uploadId}`, unit);
    assert.equal(await storage.get(orphan.pendingPath), null); assert.equal(await storage.get(orphan.finalPath), null);

    // Reservation cạnh tranh phải giữ đúng số file, không chờ tới confirm mới tính quota
    const reservations = await Promise.all(Array.from({ length: 9 }, () => reserve()));
    assert.equal(reservations.filter((row) => row.ok).length, 7);
    assert.equal(reservations.filter((row) => !row.ok && row.error.code === "EVIDENCE_QUOTA_EXCEEDED").length, 2);
    for (const row of reservations.filter((item) => item.ok)) await request("DELETE", `${path}/uploads/${row.data.uploadId}`, unit);

    // Quota dung lượng cộng giữa nhiều lá, reservation metadata đã giữ chỗ dù bytes chưa được truyền
    // Chỉ đổi fixture tiêu chí trên DB thử riêng, đây không phải API sửa cấu hình kỳ đã công bố
    await prisma.criterion.update({ where: { id: otherLeaf }, data: { allowFile: true } });
    const largeReservations: string[] = [];
    for (let index = 0; index < 10; index++) {
      const result = (await request("POST", `${path}/upload-urls`, unit, { items: [{ criterionId: otherLeaf, fileName: "Tệp lớn.pdf", mimeType: "application/pdf", sizeBytes: 10485760 }] })).body.results[0];
      if (result.ok) largeReservations.push(result.data.uploadId);
      else assert.equal(result.error.code, "EVIDENCE_QUOTA_EXCEEDED");
    }
    assert.equal(largeReservations.length, 9);
    for (const uploadId of largeReservations) await request("DELETE", `${path}/uploads/${uploadId}`, unit);

    // Lỗi provider trước commit phải giữ phiên PENDING và không tạo Evidence giả
    const storageFailure = (await reserve()).data; await put(storageFailure, pdf);
    const putObject = storage.put.bind(storage);
    storage.put = async () => { throw new Error("Lỗi kho tệp phục vụ kiểm bù lỗi"); };
    try { assert.equal((await confirm(storageFailure.uploadId)).ok, false); }
    finally { storage.put = putObject; }
    assert.equal(await prisma.evidence.count({ where: { id: storageFailure.uploadId } }), 0);
    await request("DELETE", `${path}/uploads/${storageFailure.uploadId}`, unit);

    // URL upload xin trước hạn không vượt được confirm; DB trigger cũng chặn thao tác trực tiếp
    const late = (await reserve()).data; await put(late, pdf);
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { selfEvalDeadline: new Date() } });
    assert.equal((await confirm(late.uploadId)).error.code, "EVALUATION_LOCKED");
    assert.equal((await prisma.evaluation.findUniqueOrThrow({ where: { id } })).status, "PENDING_REVIEW");
    await assert.rejects(prisma.evidence.create({ data: { id: randomUUID(), criterionScoreId: scoreId, uploaderId: userId, kind: "LINK", round: "INITIAL", externalUrl: "https://example.org", createdAt: new Date() } }));
    await request("DELETE", `${path}/uploads/${late.uploadId}`, unit);

    // Fixture đầu ra VC12: trước mở, sai mục, INITIAL và quá hạn đều bị chặn trong vòng bổ sung
    await prisma.evaluationPeriod.update({ where: { id: periodId }, data: { phase: "SUPPLEMENT" } });
    await prisma.evaluation.update({ where: { id }, data: { status: "SUPPLEMENT_REQUESTED", supplementRequestedAt: now, supplementStartAt: new Date(Date.now() + 60000), supplementDeadline: new Date(Date.now() + 3600000) } });
    await prisma.criterionScore.update({ where: { id: scoreId }, data: { needsSupplement: true } });
    assert.equal((await reserve()).error.code, "EVALUATION_LOCKED");
    await prisma.evaluation.update({ where: { id }, data: { supplementStartAt: new Date(Date.now() - 1000) } });
    assert.equal((await request("DELETE", `${path}/${evidenceIds[0]}`, unit)).status, 403);
    const supplement = (await reserve()).data; await put(supplement, pdf);
    const added = await confirm(supplement.uploadId); assert.equal(added.data.round, "SUPPLEMENT");
    assert.ok((await prisma.criterionScore.findUniqueOrThrow({ where: { id: scoreId } })).supplementedAt);
    await request("DELETE", `${path}/${added.data.id}`, unit);
    assert.equal(await storage.get(`final/${id}/${added.data.id}`), null);
    await prisma.evaluation.update({ where: { id }, data: { supplementDeadline: new Date() } });
    assert.equal((await reserve()).error.code, "EVALUATION_LOCKED");

    // Phiên quá hạn được cleanup sau restart giả lập, object CONFIRMED vẫn nguyên và idempotent còn giữ
    const staleId = randomUUID();
    await prisma.evidenceUpload.create({ data: { id: staleId, criterionScoreId: scoreId, uploaderId: userId, credentialVersion: 0, round: "SUPPLEMENT", fileName: "Tệp bỏ dở.pdf", mimeType: "application/pdf", sizeBytes: BigInt(pdf.length), pendingPath: `pending/${id}/${staleId}`, finalPath: `final/${id}/${staleId}`, createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 1000) } });
    await storage.put(`pending/${id}/${staleId}`, pdf, "application/pdf");
    await service.cleanup();
    assert.equal(await storage.get(`pending/${id}/${staleId}`), null);
    assert.equal(await prisma.evidenceUpload.count({ where: { id: staleId } }), 0);
    assert.ok(await storage.get(`final/${id}/${evidenceIds[0]}`));
    assert.equal(await prisma.evidenceUpload.count({ where: { id: evidenceIds[0], state: "CONFIRMED" } }), 1);

    // Lưu một fixture DRAFT riêng cho kiểm browser, không sửa trigger hoặc mở lại hồ sơ đã nộp
    if (process.env.VC10_BROWSER_FIXTURE_FILE) {
      const browserPeriod = randomUUID(); const browserLeaf = randomUUID(); const browserEvaluation = randomUUID();
      await prisma.evaluationPeriod.create({ data: { id: browserPeriod, year: Math.max(2051, (max._max.year ?? 2049) + 2), name: `VC10 trình duyệt ${suffix}`, maxTotalScore: 100, phase: "SELF_EVAL", publishedAt: now, selfEvalStart: new Date(+now - 60000), selfEvalDeadline: new Date(+now + 86400000), createdById: adminId, createdAt: now, updatedAt: now } });
      await prisma.criterion.create({ data: { id: browserLeaf, periodId: browserPeriod, code: "MC1", name: "Minh chứng xem trước", maxScore: 100, sortOrder: 1, createdAt: now, updatedAt: now } });
      await prisma.evaluation.create({ data: { id: browserEvaluation, periodId: browserPeriod, unitId, createdAt: now, updatedAt: now } });
      await prisma.criterionScore.create({ data: { id: randomUUID(), criterionId: browserLeaf, evaluationId: browserEvaluation, createdAt: now, updatedAt: now } });
      const pdfPath = join(root, "Báo cáo.pdf"); const pngPath = join(root, "Hoạt động.png"); const docxPath = join(root, "Biên bản.docx");
      await writeFile(pdfPath, pdf); await writeFile(pngPath, png); await writeFile(docxPath, docx);
      await writeFile(process.env.VC10_BROWSER_FIXTURE_FILE, JSON.stringify({ username: `vc10-unit-${suffix}`, adminUsername: `vc10-admin-${suffix}`, evaluationId: browserEvaluation, periodId: browserPeriod, criterionId: browserLeaf, storageRoot: root, files: [pdfPath, pngPath, docxPath] }));
    }
    // XML được tạo bởi generator Word thật, kiểm fixture không vô tình chứa macro ngoài nhánh unit
    assert.ok((await JSZip.loadAsync(docx)).file("word/document.xml"));
  } finally { await app.close(); }
});
