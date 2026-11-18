import { afterEach, expect, test, vi } from "vitest";
import apiClient from "./apiClient";
import { downloadReport } from "./reportService";

vi.mock("./apiClient", () => ({ default: { get: vi.fn() } }));
afterEach(() => vi.resetAllMocks());

/** Luôn xin metadata mới và giữ JWT trong client cùng origin, không quyết định hạn bằng giờ trình duyệt */
test("tải bằng URL mới của metadata và trả blob", async () => {
  const blob = new Blob(["nội dung"]);
  apiClient.get.mockResolvedValueOnce({ downloadUrl: "/api/v1/admin/reports/exports/report-id/download?token=chu-ky", fileName: "bao-cao.pdf" }).mockResolvedValueOnce({ data: blob });
  expect(await downloadReport("report-id")).toEqual({ blob, fileName: "bao-cao.pdf" });
  expect(apiClient.get).toHaveBeenNthCalledWith(1, "/admin/reports/exports/report-id");
  expect(apiClient.get).toHaveBeenNthCalledWith(2, "/admin/reports/exports/report-id/download?token=chu-ky", expect.objectContaining({ responseType: "blob" }));
});

/** Phản hồi URL ngoài hoặc sai mã hồ sơ không được nhận Bearer qua client dùng chung */
test("chặn URL tải ngoài endpoint hoặc sai hồ sơ", async () => {
  for (const downloadUrl of ["https://ngoai.example/tai", "/api/v1/admin/reports/exports/khac/download?token=abc", "https://["]) {
    apiClient.get.mockResolvedValueOnce({ downloadUrl });
    await expect(downloadReport("report-id")).rejects.toThrow("Liên kết tải báo cáo chưa hợp lệ");
  }
  expect(apiClient.get).toHaveBeenCalledTimes(3);
});
