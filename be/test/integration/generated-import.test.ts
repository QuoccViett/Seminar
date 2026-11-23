import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { createVc12Harness } from "./vc12-support.js";

/** Dùng đúng generator FE, tải bytes XLSX rồi preview/confirm trên Nest/PostgreSQL thật */
test("Excel sinh 1/34/100 dòng giữ preview khô và confirm idempotent", { timeout: 600_000 }, async () => {
  const h = await createVc12Harness();
  const generator = await import(new URL("../../../fe/src/services/importWorkbook.js", import.meta.url).href) as { IMPORT_DEFAULTS: Record<string, unknown>; createImportWorkbook(values: Record<string, unknown>): Promise<File> };
  try {
    for (const count of [1, 34, 100]) {
      const prefix = `gen${randomUUID().slice(0, 8)}`;
      let file = await generator.createImportWorkbook({ ...generator.IMPORT_DEFAULTS, count, start: 7, usernamePrefix: prefix, unitPrefix: prefix, domain: "example.invalid" });
      if (count === 1) {
        const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
        book.worksheets[0]!.getCell("E2").value = "Người nhận đã sửa trong bản nháp";
        book.worksheets[0]!.getCell("G2").value = "0900000001";
        file = new File([new Uint8Array(await book.xlsx.writeBuffer())], file.name, { type: file.type });
      }
      const before = await h.prisma.user.count();
      const form = new FormData(); form.append("file", file, file.name);
      const response = await fetch(`${h.base}/api/v1/users/import/preview`, { method: "POST", headers: { authorization: `Bearer ${h.adminToken}`, "Idempotency-Key": randomUUID() }, body: form });
      assert.equal(response.status, 201);
      const preview = await response.json() as { importId: string; validRows: number; invalidRows: number; rows: { username: string; fullName: string; phone: string }[] };
      assert.equal(preview.validRows, count); assert.equal(preview.invalidRows, 0);
      assert.equal(preview.rows[0]!.username, `${prefix}007`);
      if (count === 1) { assert.equal(preview.rows[0]!.fullName, "Người nhận đã sửa trong bản nháp"); assert.equal(preview.rows[0]!.phone, "0900000001"); }
      assert.equal(await h.prisma.user.count(), before);
      const confirmed = await h.request("POST", `users/import/${preview.importId}/confirm`, h.adminToken, {});
      assert.equal(confirmed.status, 200);
      assert.equal(await h.prisma.user.count({ where: { username: { startsWith: prefix } } }), count);
      assert.equal((await h.request("POST", `users/import/${preview.importId}/confirm`, h.adminToken, {})).status, 200);
      assert.equal(await h.prisma.user.count(), before + count);
    }
  } finally { await h.app.close(); }
});
