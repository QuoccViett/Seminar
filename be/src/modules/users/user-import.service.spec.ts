import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { UserImportService } from "./user-import.service.js";

/** Tạo XLSX trong bộ nhớ để kiểm tra parser mà không kết nối hoặc ghi vào cơ sở dữ liệu
 * Đầu vào là các dòng giá trị và header tùy chọn; đầu ra là Buffer có cấu trúc ZIP/XLSX hoàn chỉnh
 * Dùng header chuẩn mặc định, còn ca sai định dạng truyền header riêng để xác minh parser từ chối
 */
async function makeWorkbook(rows: unknown[][], headers = ["unitCode", "unitName", "unitType", "username", "fullName", "email", "phone"]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import UNIT");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Dựng service chỉ để gọi parser/template, không tạo giả hành vi database hoặc provider
 * Đầu ra giữ cùng lớp xử lý sản phẩm; các dependency rỗng không được chạm trong nhóm kiểm thử thuần file
 */
function makeParser(): UserImportService {
  return new UserImportService({} as never, {} as never, {} as never, {} as never);
}

/** Kiểm tra workbook mẫu do backend tạo có thể đọc lại bằng parser thật
 * Kết quả kỳ vọng giữ username đã chuẩn hóa, phone dạng text có số 0 đầu và không có lỗi dòng
 */
test("createTemplate returns the agreed columns and preserves phone as text", async () => {
  const parser = makeParser();
  const buffer = await parser.createTemplate();
  const rows = await parser.parse({ buffer, size: buffer.length, originalname: "mau.xlsx" });

  assert.deepEqual(rows.map(({ unitCode, username, phone, errors }) => ({ unitCode, username, phone, errors })), [
    { unitCode: "COSO01", username: "coso01", phone: "0900000001", errors: [] },
  ]);
});

/** Cung cấp header thiếu cột để kiểm parser từ chối cấu trúc trước khi trả preview
 * Điều kiện kỳ vọng là HTTP 422, không chấp nhận row dữ liệu dù workbook vẫn là ZIP hợp lệ
 */
test("parse rejects a workbook whose headers differ from the import contract", async () => {
  const buffer = await makeWorkbook([["A", "Đơn vị", "CO_SO", "coso01", "Đơn vị", "a@example.com", "0900000001"]], ["username", "unitName"]);

  await assert.rejects(
    makeParser().parse({ buffer, size: buffer.length, originalname: "sai.xlsx" }),
    (error: unknown) => typeof error === "object" && error !== null && "getStatus" in error && error.getStatus() === 422,
  );
});

/** Đặt formula object vào ô mã đơn vị để kiểm parser không tính biểu thức bảng tính
 * Nhánh đặc biệt phải trả mã FORMULA_NOT_ALLOWED cùng nội dung tiếng Việt thay vì giữ giá trị cache
 */
test("parse rejects formula cells without evaluating them", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Import UNIT");
  sheet.addRow(["unitCode", "unitName", "unitType", "username", "fullName", "email", "phone"]);
  sheet.addRow(["A", "Đơn vị", "DON_VI_TRUC_THUOC", "coso01", "Đơn vị", "a@example.com", "0900000001"]);
  sheet.getCell("A2").value = { formula: '"A"', result: "A" };
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  await assert.rejects(
    makeParser().parse({ buffer, size: buffer.length, originalname: "cong-thuc.xlsx" }),
    (error: unknown) => typeof error === "object" && error !== null && "getResponse" in error && JSON.stringify(error.getResponse()).includes("FORMULA_NOT_ALLOWED"),
  );
});

/** Tạo hai dòng có cùng mã đơn vị nhưng khác username để kiểm duplicate ở cấp tệp
 * Cả hai dòng phải mang mã DUPLICATE_UNIT_CODE để Admin tự sửa, không tự chọn dòng thắng
 */
test("parse marks duplicate unit codes on each affected row", async () => {
  const buffer = await makeWorkbook([
    ["A", "Đơn vị A", "DON_VI_TRUC_THUOC", "coso01", "Đơn vị A", "a@example.com", "0900000001"],
    ["A", "Đơn vị A", "DON_VI_TRUC_THUOC", "coso02", "Đơn vị A", "b@example.com", "0900000002"],
  ]);
  const rows = await makeParser().parse({ buffer, size: buffer.length, originalname: "trung.xlsx" });

  assert.equal(rows.every((row) => row.errors.some((error) => error.code === "DUPLICATE_UNIT_CODE")), true);
});
