import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createImportWorkbook, generateImportRows, IMPORT_DEFAULTS, IMPORT_HEADERS } from "./importWorkbook";

describe("bản nháp Excel tài khoản UNIT", () => {
  for (const count of [1, 34, 100]) it(`đọc lại đủ ${count} dòng văn bản và giữ số 0 đầu`, async () => {
    const options = { ...IMPORT_DEFAULTS, count, start: 7, digits: 3 };
    const file = await createImportWorkbook(options);
    const book = new ExcelJS.Workbook();
    const bytes = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(file); });
    await book.xlsx.load(bytes);
    const sheet = book.worksheets[0];
    expect(sheet.rowCount).toBe(count + 1);
    expect(sheet.getRow(1).values.slice(1)).toEqual(IMPORT_HEADERS);
    expect(sheet.getCell("A2").value).toBe("DV007");
    expect(sheet.getCell("D2").value).toBe("donvi007");
    expect(sheet.getCell("F2").value).toBe("donvi007@example.com");
    sheet.eachRow((row) => row.eachCell((cell) => expect(typeof cell.value).toBe("string")));
    expect(new Set(generateImportRows(options).map((row) => row.username)).size).toBe(count);
  });

  it.each([{ count: 0 }, { count: 101 }, { start: -1 }, { count: 1.5 }, { digits: 0 }, { domain: "@invalid" }, { usernamePrefix: "có dấu" }, { unitName: "=SUM(A1)" }, { unitType: "ADMIN" }])("chặn cấu hình sinh không hợp lệ %j", (invalid) => {
    expect(() => generateImportRows({ ...IMPORT_DEFAULTS, ...invalid })).toThrow();
  });
});
