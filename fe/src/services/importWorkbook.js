export const IMPORT_HEADERS = ["unitCode", "unitName", "unitType", "username", "fullName", "email", "phone"];
export const IMPORT_DEFAULTS = { count: 34, start: 1, digits: 3, unitPrefix: "DV", usernamePrefix: "donvi", unitName: "Đơn vị {n}", fullName: "Tài khoản đơn vị {n}", domain: "example.com", unitType: "DON_VI_TRUC_THUOC" };
const unitTypes = ["CONG_AN_QUAN_HUYEN", "PHONG_NGHIEP_VU", "DON_VI_TRUC_THUOC"];

/** Sinh dữ liệu văn bản cho bản nháp; không gọi API hoặc tạo tài khoản */
export function generateImportRows(values) {
  const { count, start, digits, unitPrefix, usernamePrefix, unitName, fullName, domain, unitType } = values;
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Số lượng phải từ 1 đến 100");
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(start + count - 1)) throw new Error("Số bắt đầu phải là số nguyên không âm hợp lệ");
  if (!Number.isInteger(digits) || digits < 1 || digits > 12) throw new Error("Số chữ số phải từ 1 đến 12");
  if (!/^[a-z0-9._-]+$/i.test(usernamePrefix ?? "") || !unitPrefix?.trim()) throw new Error("Vui lòng nhập tiền tố; tên đăng nhập chỉ dùng chữ không dấu, số, chấm, gạch dưới hoặc gạch ngang");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain ?? "")) throw new Error("Domain email không hợp lệ; không nhập ký tự @");
  if (!unitTypes.includes(unitType)) throw new Error("Vui lòng chọn loại đơn vị hợp lệ");
  if (!unitName?.trim() || !fullName?.trim()) throw new Error("Vui lòng nhập cả hai mẫu tên");
  return Array.from({ length: count }, (_, index) => {
    const n = String(start + index).padStart(digits, "0");
    const username = `${usernamePrefix}${n}`.toLowerCase();
    const row = { unitCode: `${unitPrefix.trim()}${n}`, unitName: unitName.replaceAll("{n}", n).trim(), unitType, username, fullName: fullName.replaceAll("{n}", n).trim(), email: `${username}@${domain.toLowerCase()}`, phone: "" };
    if (username.length < 3 || username.length > 64 || row.unitCode.length > 64 || row.unitName.length > 200 || row.fullName.length > 200 || row.email.length > 200) throw new Error("Dữ liệu sinh vượt giới hạn cột của mẫu import");
    if (Object.values(row).some((value) => /^[=+@-]/.test(value))) throw new Error("Dữ liệu không được bắt đầu bằng ký tự công thức Excel");
    return row;
  });
}

/** ExcelJS được nạp khi cần; mọi ô dữ liệu là chuỗi, giữ số 0 đầu và không tạo công thức */
export async function createImportWorkbook(values) {
  const rows = generateImportRows(values);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("TaiKhoan");
  sheet.addRow(IMPORT_HEADERS);
  rows.forEach((row) => sheet.addRow(IMPORT_HEADERS.map((key) => row[key])));
  sheet.columns.forEach((column) => { column.width = 25; column.numFmt = "@"; });
  return new File([await workbook.xlsx.writeBuffer()], "danh-sach-tai-khoan-nhap.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
