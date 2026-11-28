import assert from "node:assert/strict";
import { test } from "node:test";
import { CriteriaService } from "./criteria.service.js";
import { Prisma } from "../../generated/prisma/client.js";

const periodId = "11111111-1111-4111-8111-111111111111";
const opening = new Date("2026-11-18T03:00:00.000Z");

/** Tạo service với các lời gọi Prisma được thay theo tình huống kiểm tra
 * overrides cho phép kiểm soát kỳ và kết quả query tiêu chí
 * Mảng audit xác nhận service chỉ ghi nhận thay đổi sau khi thao tác thành công
 */
function makeService(overrides: Record<string, unknown> = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let reads = 0;
  const prisma = {
    $queryRaw: async () => [],
    $transaction: async (callback: (tx: unknown) => unknown) => callback(prisma),
    evaluationPeriod: { findUnique: async () => ({ id: periodId, publishedAt: null, selfEvalStart: opening }) },
    criterion: {
      findMany: async () => { reads += 1; return [{ id: "leaf-1", parentId: null, sortOrder: 1 }]; },
      create: async (args: Record<string, unknown>) => { writes.push(args); return { id: "criterion-1", ...(args.data as object) }; },
      ...overrides,
    },
  };
  const clock = { now: () => new Date(opening) };
  const audit = { record: async (payload: Record<string, unknown>) => { audits.push(payload); } };
  return { service: new CriteriaService(prisma as never, audit as never, clock as never), prisma, writes, audits, getReads: () => reads };
}

/** Không cho UNIT dò cấu trúc nháp và tránh query danh sách tiêu chí
 * Kỳ mẫu chưa có publishedAt, còn người gọi có vai trò UNIT
 * API trả 404 chung để không xác nhận tài nguyên chưa công bố tồn tại
 */
test("ẩn cây tiêu chí trước khi kỳ được công bố", async () => {
  const { service, getReads } = makeService();
  await assert.rejects(service.findByPeriod(periodId, { id: "unit", role: "UNIT", unitId: "unit-1" }), (error: unknown) =>
    (error as { getStatus(): number; getResponse(): { code?: string } }).getStatus() === 404 &&
    (error as { getResponse(): { code?: string } }).getResponse().code === "NOT_FOUND",
  );
  assert.equal(getReads(), 0);
});

/** Chặn nội dung khi kỳ đã công bố nhưng start vẫn ở tương lai theo clock
 * Đặt mốc mở muộn hơn thời gian server một mili giây
 * API trả NOT_OPEN_YET và không truy vấn các hàng tiêu chí
 */
test("tiêu chí của kỳ đã công bố vẫn bị chặn trước giờ mở", async () => {
  const { service, prisma, getReads } = makeService();
  (prisma.evaluationPeriod as { findUnique: () => Promise<unknown> }).findUnique = async () => ({ id: periodId, publishedAt: opening, selfEvalStart: new Date(opening.getTime() + 1) });
  await assert.rejects(service.findByPeriod(periodId, { id: "unit", role: "UNIT", unitId: "unit-1" }), (error: unknown) =>
    (error as { getStatus(): number; getResponse(): { code?: string } }).getStatus() === 400 &&
    (error as { getResponse(): { code?: string } }).getResponse().code === "NOT_OPEN_YET",
  );
  assert.equal(getReads(), 0);
});

/** Cho UNIT đọc cây ở thời điểm bằng chính mốc mở theo khoảng nửa mở
 * publishedAt và selfEvalStart cùng bằng giờ server cố định
 * Xác nhận tiêu chí lá được gom vào cây và truy vấn chỉ chạy sau khi quyền hợp lệ
 */
test("UNIT đọc được cây đúng tại mốc mở sau khi kỳ đã công bố", async () => {
  const { service, prisma, getReads } = makeService();
  (prisma.evaluationPeriod as { findUnique: () => Promise<unknown> }).findUnique = async () => ({ id: periodId, publishedAt: opening, selfEvalStart: opening });
  const result = await service.findByPeriod(periodId, { id: "unit", role: "UNIT", unitId: "unit-1" });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.children.length, 0);
  assert.equal(getReads(), 1);
});

/** Giữ nguyên thang điểm sau công bố bằng cách chặn mọi thao tác thêm tiêu chí
 * Kỳ mẫu đã có publishedAt trước request của Admin
 * Xác nhận service từ chối trước khi gọi Prisma create
 */
test("không tạo tiêu chí sau khi kỳ đã công bố", async () => {
  const { service, prisma, writes } = makeService();
  (prisma.evaluationPeriod as { findUnique: () => Promise<unknown> }).findUnique = async () => ({ id: periodId, publishedAt: opening });
  await assert.rejects(service.create(periodId, { code: "1", name: "Mục", maxScore: 10, sortOrder: 1 }, "admin-1"));
  assert.equal(writes.length, 0);
});

/** Không cho di chuyển cả nhánh khiến tiêu chí con vượt giới hạn tám cấp
 * Chuỗi cha mới gồm bảy cấp, tiêu chí đang di chuyển có một con nên sẽ thành cấp chín
 * Kỳ đang nháp nhưng transaction phải từ chối trước khi ghi hoặc tạo audit
 */
test("chặn di chuyển nhánh có con vượt quá tám cấp", async () => {
  const parents = Array.from({ length: 7 }, (_, index) => ({ id: `parent-${index}`, periodId, parentId: index === 6 ? null : `parent-${index + 1}` }));
  const { service, prisma, audits } = makeService({
    findUnique: async ({ where }: { where: { id: string } }) => where.id === "moving" ? { id: "moving", periodId, parentId: null } : parents.find((item) => item.id === where.id) ?? null,
    findMany: async () => [{ id: "moving", parentId: null }, { id: "child", parentId: "moving" }],
    update: async () => { throw new Error("Không được ghi tiêu chí vượt độ sâu"); },
  });
  (prisma.evaluationPeriod as { findUnique: () => Promise<unknown> }).findUnique = async () => ({ id: periodId, publishedAt: null });
  await assert.rejects(service.update(periodId, "moving", { parentId: "parent-0" }, "admin"), (error: unknown) => (error as { getStatus(): number }).getStatus() === 400);
  assert.equal(audits.length, 0);
});

/** Dùng số thập phân thật và cây có anh em để kiểm thao tác lưu, không chỉ kiểm công bố. */
test("thêm/sửa chặn vượt điểm cha, tổng anh em, giảm cha và chuyển sang cha thiếu điểm", async () => {
  const nodes = [
    { id: "parent", parentId: null, maxScore: new Prisma.Decimal(10) },
    { id: "child", parentId: "parent", maxScore: new Prisma.Decimal(6) },
    { id: "sibling", parentId: "parent", maxScore: new Prisma.Decimal(4) },
    { id: "other", parentId: null, maxScore: new Prisma.Decimal(5) },
  ].map((node) => ({ ...node, periodId }));
  for (const [id, dto] of [
    [null, { parentId: "parent", maxScore: 11 }],
    [null, { parentId: "parent", maxScore: 1 }],
    ["child", { maxScore: 11 }],
    ["child", { maxScore: 7 }],
    ["parent", { maxScore: 9.99 }],
    ["child", { parentId: "other" }],
  ] as const) {
    const { service, writes, audits } = makeService({
      findMany: async () => nodes,
      findUnique: async ({ where }: { where: { id: string } }) => nodes.find((node) => node.id === where.id) ?? null,
      update: async (args: Record<string, unknown>) => { writes.push(args); return {}; },
    });
    const saving = id ? service.update(periodId, id, dto, "admin") : service.create(periodId, { code: "new", name: "Con mới", sortOrder: 1, ...dto }, "admin");
    await assert.rejects(saving, (error: unknown) => {
      const failure = error as { getStatus(): number; getResponse(): { details: Array<{ field: string }> } };
      return failure.getStatus() === 400 && failure.getResponse().details[0]?.field === "maxScore";
    });
    assert.equal(writes.length, 0);
    assert.equal(audits.length, 0);
  }
});

test("cho phép lưu từng phần, bằng điểm cha, số lẻ và sửa không cộng trùng chính nó", async () => {
  const nodes = [
    { id: "parent", parentId: null, maxScore: new Prisma.Decimal("0.3") },
    { id: "child", parentId: "parent", maxScore: new Prisma.Decimal("0.1") },
  ].map((node) => ({ ...node, periodId }));
  const { service, writes, audits } = makeService({
    findMany: async () => nodes,
    findUnique: async ({ where }: { where: { id: string } }) => nodes.find((node) => node.id === where.id) ?? null,
    update: async (args: { where: { id: string }; data: object }) => { writes.push(args); return { ...nodes.find((node) => node.id === args.where.id), ...args.data }; },
  });
  await service.create(periodId, { code: "2", name: "Con", parentId: "parent", maxScore: 0.2, sortOrder: 2 }, "admin");
  await service.update(periodId, "child", { maxScore: 0.3 }, "admin");
  await service.update(periodId, "child", { name: "Đổi tên" }, "admin");
  await service.update(periodId, "child", { parentId: null, maxScore: 1 }, "admin");
  assert.equal(writes.length, 4);
  assert.equal(audits.length, 4);
});
