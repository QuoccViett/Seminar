import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import { NestFactory } from "@nestjs/core";
import type { PrismaService as PrismaServiceType } from "../../src/prisma/prisma.service.js";

type CriterionInput = { code: string; name: string; maxScore: number; sortOrder: number; parentCode: string | null };
type CriterionNode = { id: string; code: string; name: string; maxScore: number | string; children: CriterionNode[] };
type ApiResult = {
  id: string; accessToken: string; code: string; criteriaVisible: boolean; year: number; selfEvalState: string; maxTotalScore?: number;
  canPublish: boolean; checks: Array<{ code: string; passed: boolean }>;
};

/** Đọc điểm gốc hoặc kết quả cache của công thức, không chạy công thức trong workbook
 * cell phải chứa số hữu hạn hoặc chuỗi số không âm, công thức phải có cache từ Excel
 * Từ chối ô trống/lỗi để không âm thầm biến một tiêu chí thiếu điểm thành điểm 0
 */
function points(cell: ExcelJS.Cell): number {
  const value = cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value;
  assert.ok(typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())), "Ô điểm phải là số hoặc công thức có kết quả số đã lưu");
  const result = Number(value);
  assert.ok(Number.isFinite(result) && result >= 0, "Điểm trong workbook phải hữu hạn và không âm");
  return result;
}

/** Tải đúng các vùng tiêu chí của mẫu, không lấy họ tên, ngày sinh hoặc điểm đã tự chấm
 * Nội dung nhóm A lấy nguyên văn và cấu trúc mã cha/con, điểm lấy cột tối đa E
 * Bảng 2 chỉ lấy sáu mục điểm tối đa E và gắn mã theo trục để tránh mã 1 trùng nhau
 * Đây là ánh xạ fixture kiểm thử, không phải tính năng import hay công thức KPI của sản phẩm
 */
async function readCriteria(path: string) {
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch { throw new Error("Không thể đọc file XLSX tiêu chí đã chỉ định"); }
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes.buffer as unknown as import("exceljs").Buffer); }
  catch { throw new Error("File tiêu chí không phải workbook XLSX hợp lệ"); }
  assert.equal(workbook.worksheets.length, 3, "Mẫu kiểm thử phải có đúng ba sheet đã đối chiếu");
  const sheet = workbook.worksheets[0]!;
  assert.match(sheet.getCell("B18").text, /Tiêu chí/u, "Không đúng vùng tiêu chí nhóm A của mẫu");
  const totalA = points(sheet.getCell("E38"));
  const groupA: CriterionInput[] = [{ code: "A", name: sheet.getCell("B17").text.trim(), maxScore: totalA, sortOrder: 17, parentCode: null }];
  for (let row = 19; row <= 37; row++) {
    const code = sheet.getCell(`A${row}`).text.trim();
    assert.match(code, /^\d+(?:\.\d+)*$/, "Mã tiêu chí nhóm A đã đổi cấu trúc");
    const parentCode = code.includes(".") ? code.slice(0, code.lastIndexOf(".")) : "A";
    groupA.push({ code, name: sheet.getCell(`B${row}`).text.trim(), maxScore: points(sheet.getCell(`E${row}`)), sortOrder: row, parentCode });
  }
  // B và C chỉ là đầu vào kiểm sự không tương thích của phép cộng 107 với tổng 100 trong mẫu
  const fullForm: CriterionInput[] = [
    ...groupA,
    { code: "B", name: sheet.getCell("A42").text.trim(), maxScore: points(sheet.getCell("D42")), sortOrder: 42, parentCode: null },
    { code: "C", name: sheet.getCell("A43").text.trim(), maxScore: points(sheet.getCell("D43")), sortOrder: 43, parentCode: null },
  ];
  const kpiSheet = workbook.getWorksheet("Bang 2");
  assert.ok(kpiSheet, "Không tìm thấy sheet Bảng 2 trong mẫu");
  const kpi: CriterionInput[] = [];
  for (const row of [18, 20, 22, 24, 26, 28]) {
    const axis = kpiSheet.getCell(`A${row - 1}`).text.trim();
    const code = kpiSheet.getCell(`A${row}`).text.trim();
    const maximum = points(kpiSheet.getCell(`E${row}`));
    kpi.push({ code: `KPI.${axis}`, name: kpiSheet.getCell(`B${row - 1}`).text.trim(), maxScore: maximum, sortOrder: row - 1, parentCode: null });
    kpi.push({ code: `KPI.${axis}.${code}`, name: kpiSheet.getCell(`B${row}`).text.trim(), maxScore: maximum, sortOrder: row, parentCode: `KPI.${axis}` });
  }
  return { groupA, fullForm, kpi, totalA, fullTotal: points(sheet.getCell("D44")), hash: createHash("sha256").update(bytes).digest("hex") };
}

/** Kiểm dữ liệu workbook thật qua HTTP Nest và PostgreSQL riêng, không sửa file gốc
 * Chỉ cho phép database vc08_test, dùng tài khoản test và tắt toàn bộ provider ngoài
 * Nhóm A kiểm cây ba cấp và 16 lá, Bảng 2 kiểm điểm thập phân, toàn phiếu kiểm chặn tổng sai
 * Không suy diễn rằng công thức KPI/điểm thưởng hoặc import Excel tiêu chí đã có trong sản phẩm
 */
test("VC08 đối chiếu tiêu chí từ workbook thật và chặn công bố tổng không tương thích", { timeout: 120_000 }, async () => {
  const databaseUrl = process.env.VC08_TEST_DATABASE_URL;
  const workbookPath = process.env.VC08_CRITERIA_WORKBOOK_PATH;
  assert.ok(databaseUrl && new URL(databaseUrl).pathname === "/vc08_test", "Cần PostgreSQL vc08_test riêng để kiểm thử workbook");
  assert.ok(workbookPath, "Cần chỉ định đường dẫn file XLSX tiêu chí qua VC08_CRITERIA_WORKBOOK_PATH");
  const fixture = await readCriteria(workbookPath);
  assert.equal(fixture.groupA.length, 20);
  assert.equal(fixture.totalA, 30);
  assert.equal(fixture.fullTotal, 100);
  assert.ok(fixture.groupA.some((criterion) => criterion.name.length > 500), "Cần giữ nguyên tiêu chí dài của mẫu để kiểm round-trip");
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = "vc08-test-secret-only-at-least-32-characters";
  process.env.WEB_ORIGINS = "http://127.0.0.1:5178";
  process.env.PUBLIC_APP_URL = "http://127.0.0.1:5178";
  process.env.NODE_ENV = "test";
  process.env.EMAIL_ENABLED = "false";
  process.env.WEB_PUSH_ENABLED = "false";
  process.env.ZALO_ZNS_ENABLED = "false";
  const dist = new URL("../../dist/", import.meta.url);
  const { AppModule } = await import(new URL("app.module.js", dist).href);
  const { PrismaService } = await import(new URL("prisma/prisma.service.js", dist).href);
  const { ClockService } = await import(new URL("common/services/clock.service.js", dist).href);
  const { AllExceptionsFilter } = await import(new URL("common/filters/all-exceptions.filter.js", dist).href);
  const { createApiValidationPipe } = await import(new URL("common/pipes/api-validation.pipe.js", dist).href);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  const prisma = app.get<PrismaServiceType>(PrismaService);
  const clock = app.get(ClockService);
  const base = await app.getUrl();
  let instant = new Date("2026-11-28T16:29:59.999Z");
  clock.now = () => new Date(instant);

  /** Gửi JSON tới backend thật và chỉ trả dữ liệu hợp đồng để kiểm assertion
   * token là phiên thật do Auth cấp, không in mật khẩu/token hoặc toàn workbook vào log
   */
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const result = await fetch(`${base}/api/v1/${path}`, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.status, body: await result.json() as ApiResult };
  }

  /** Đếm lá đệ quy từ cây HTTP để không tính cả nhóm cha vào tổng và số score
   * nodes là response thật của GET cây, trả danh sách lá để đối chiếu với DB
   */
  function leaves(nodes: CriterionNode[]): CriterionNode[] {
    return nodes.flatMap((node) => node.children.length ? leaves(node.children) : [node]);
  }

  try {
    const suffix = randomUUID().slice(0, 8);
    const now = new Date();
    const unitId = randomUUID();
    const adminId = randomUUID();
    const password = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.unit.create({ data: { id: unitId, code: `VC08-XLSX-${suffix}`, name: "Đơn vị kiểm thử workbook", isActive: true, createdAt: now, updatedAt: now } });
    await prisma.user.createMany({ data: [
      { id: adminId, username: `xlsx-admin-${suffix}`, passwordHash, fullName: "Quản trị kiểm thử workbook", role: "ADMIN", mustChangePassword: false, createdAt: now, updatedAt: now },
      { id: randomUUID(), username: `xlsx-unit-${suffix}`, passwordHash, fullName: "Đơn vị kiểm thử workbook", role: "UNIT", unitId, mustChangePassword: false, createdAt: now, updatedAt: now },
    ] });
    const admin = await request("POST", "auth/login", undefined, { username: `xlsx-admin-${suffix}`, password });
    const unit = await request("POST", "auth/login", undefined, { username: `xlsx-unit-${suffix}`, password });
    assert.equal(admin.status, 200);
    assert.equal(unit.status, 200);
    const latest = await prisma.evaluationPeriod.aggregate({ _max: { year: true } });
    let year = (latest._max.year ?? 2025) + 1;
    const thresholds = [
      { rating: "EXCELLENT", label: "Xuất sắc", minPercent: 85, minExclusive: true },
      { rating: "GOOD", label: "Tốt", minPercent: 65, minExclusive: false },
      { rating: "PASS", label: "Đạt", minPercent: 50, minExclusive: false },
      { rating: "FAIL", label: "Chưa đạt", minPercent: 0, minExclusive: false },
    ];

    /** Tạo cấu hình qua API từ vùng đã ánh xạ, cha được tạo trước con và ID do server cấp
     * Chỉ gửi nội dung/điểm tối đa, không nhập điểm tự chấm có sẵn hoặc danh tính trong mẫu
     * Đây là công cụ nạp fixture test, không ghi thẳng các tiêu chí vào Prisma để vượt validation
     */
    async function createPeriod(name: string, maxTotalScore: number, inputs: CriterionInput[]) {
      const created = await request("POST", "evaluation-periods", admin.body.accessToken, {
        name, year: year++, maxTotalScore, selfEvalStart: "2026-11-28T16:30:00Z", selfEvalDeadline: "2026-11-28T17:00:00Z",
      });
      assert.equal(created.status, 201, "Không tạo được kỳ kiểm thử workbook");
      assert.equal((await request("PUT", `evaluation-periods/${created.body.id}/thresholds`, admin.body.accessToken, thresholds)).status, 200);
      const ids = new Map<string, string>();
      for (const { parentCode, ...input } of inputs) {
        const parentId = parentCode ? ids.get(parentCode) : null;
        assert.ok(!parentCode || parentId, "Cần tạo cha trước tiêu chí con");
        const saved = await request("POST", `evaluation-periods/${created.body.id}/criteria`, admin.body.accessToken, { ...input, parentId, allowText: true, allowFile: true, allowLink: true });
        assert.equal(saved.status, 201, `Không lưu được tiêu chí ${input.code} từ workbook`);
        ids.set(input.code, saved.body.id);
      }
      return { id: created.body.id, ids };
    }

    const group = await createPeriod("Kiểm workbook - nhóm A 30 điểm", fixture.totalA, fixture.groupA);
    const check = await request("GET", `evaluation-periods/${group.id}/publish-check`, admin.body.accessToken);
    assert.equal(check.body.canPublish, true);
    const treeResponse = await request("GET", `evaluation-periods/${group.id}/criteria`, admin.body.accessToken);
    const tree = treeResponse.body as unknown as CriterionNode[];
    assert.equal(tree.length, 1);
    assert.deepEqual(tree[0]!.children.map((node) => [node.code, Number(node.maxScore)]), [["1", 18], ["2", 4], ["3", 8]]);
    assert.equal(leaves(tree).length, 16);
    assert.equal(leaves(tree).reduce((total, node) => total + Number(node.maxScore), 0), 30);
    for (const input of fixture.groupA.filter((criterion) => criterion.parentCode?.includes(".") === false && criterion.code.includes("."))) {
      assert.equal(leaves(tree).find((node) => node.code === input.code)?.name, input.name);
    }
    assert.equal((await request("POST", `evaluation-periods/${group.id}/publish`, admin.body.accessToken)).status, 200);
    const evaluation = await prisma.evaluation.findUniqueOrThrow({ where: { periodId_unitId: { periodId: group.id, unitId } }, include: { criterionScores: true } });
    assert.equal(evaluation.criterionScores.length, 16);
    assert.ok(evaluation.criterionScores.every((score) => score.selfScore === null && score.adminScore === null));
    const hidden = await request("GET", `evaluation-periods/${group.id}`, unit.body.accessToken);
    assert.equal(hidden.body.criteriaVisible, false);
    assert.equal(hidden.body.maxTotalScore, undefined);
    assert.equal((await request("GET", `evaluation-periods/${group.id}/criteria`, unit.body.accessToken)).body.code, "NOT_OPEN_YET");
    instant = new Date("2026-11-28T16:30:00Z");
    assert.equal(leaves((await request("GET", `evaluation-periods/${group.id}/criteria`, unit.body.accessToken)).body as unknown as CriterionNode[]).length, 16);
    assert.equal((await request("PATCH", `criteria/${group.ids.get("1.1")}`, admin.body.accessToken, { maxScore: 3 })).status, 400);

    // Điểm tối đa Bảng 2 dùng cache số có sẵn, không áp công thức chuẩn hóa 70 × B/A của file
    const kpiTotal = fixture.kpi.filter((criterion) => criterion.parentCode !== null).reduce((total, criterion) => total + criterion.maxScore, 0);
    assert.equal(kpiTotal, 66.4);
    const kpi = await createPeriod("Kiểm workbook - điểm thập phân Bảng 2", kpiTotal, fixture.kpi);
    assert.equal((await request("GET", `evaluation-periods/${kpi.id}/publish-check`, admin.body.accessToken)).body.canPublish, true);
    assert.equal((await request("POST", `evaluation-periods/${kpi.id}/publish`, admin.body.accessToken)).status, 200);
    assert.equal(await prisma.criterionScore.count({ where: { evaluation: { periodId: kpi.id, unitId } } }), 6);

    // Giữ nguyên A=30, B=70, C=7 và tổng 100 để chứng minh backend không công bố phép cộng sai
    const full = await createPeriod("Kiểm workbook - A+B+C vượt tổng", fixture.fullTotal, fixture.fullForm);
    const fullCheck = await request("GET", `evaluation-periods/${full.id}/publish-check`, admin.body.accessToken);
    assert.equal(fullCheck.body.checks.find((item) => item.code === "leafTotal")?.passed, false);
    const rejected = await request("POST", `evaluation-periods/${full.id}/publish`, admin.body.accessToken);
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.code, "PUBLISH_CHECK_FAILED");
    assert.equal(await prisma.evaluation.count({ where: { periodId: full.id } }), 0);
    assert.equal((await prisma.evaluationPeriod.findUniqueOrThrow({ where: { id: full.id } })).publishedAt, null);
    assert.equal((await request("GET", `evaluation-periods/${full.id}`, unit.body.accessToken)).status, 404);
    assert.equal(createHash("sha256").update(await readFile(workbookPath)).digest("hex"), fixture.hash, "File workbook gốc phải giữ nguyên sau kiểm thử");
    console.log(JSON.stringify({ groupNodes: fixture.groupA.length, groupLeaves: 16, groupPoints: fixture.totalA, kpiLeaves: 6, kpiPoints: kpiTotal, fullPoints: 107, fullMaximum: fixture.fullTotal, fullPublishRejected: true, sha256: fixture.hash }));
  } finally {
    await app.close();
  }
});
