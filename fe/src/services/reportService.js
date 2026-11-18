import apiClient from "./apiClient";

/** Tạo báo cáo đồng bộ ở backend, caller chỉ nhận READY sau khi bytes và audit đã lưu
 * Tăng timeout cho biểu mẫu nhiều tiêu chí, lỗi vẫn đi qua chuẩn hóa dùng chung của API
 */
export const createReport = (body) => apiClient.post("/admin/reports/exports", body, { timeout: 120000 });

/** Lọc và phân trang metadata thật theo kỳ, loại và định dạng, không sinh dữ liệu báo cáo ở trình duyệt */
export const listReports = (params) => apiClient.get("/admin/reports/exports", { params });

/** Xin metadata mới rồi tải bằng JWT và chữ ký ngắn hạn, không dựa vào đồng hồ FE để quyết định quyền
 * Chỉ nhận đường dẫn của đúng endpoint và đúng ID, tránh gắn Bearer vào URL ngoài nếu phản hồi bất thường
 * Trả blob và tên cho component quản lý vòng đời object URL, không lưu chữ ký vào localStorage
 */
export async function downloadReport(id) {
  const metadata = await apiClient.get(`/admin/reports/exports/${id}`);
  let parsed;
  try { parsed = new URL(metadata.downloadUrl, "https://report.invalid"); }
  catch { throw new Error("Liên kết tải báo cáo chưa hợp lệ"); }
  if (parsed.origin !== "https://report.invalid" || parsed.pathname !== `/api/v1/admin/reports/exports/${id}/download` || !parsed.searchParams.get("token")) throw new Error("Liên kết tải báo cáo chưa hợp lệ");
  const response = await apiClient.get(parsed.pathname.replace(/^\/api\/v1/, "") + parsed.search, { responseType: "blob", timeout: 120000 });
  return { blob: response.data, fileName: metadata.fileName ?? "bao-cao" };
}
