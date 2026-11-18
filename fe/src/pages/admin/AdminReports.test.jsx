import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import AdminReports from "./AdminReports";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { listEvaluations } from "../../services/evaluationService";
import { createReport, listReports } from "../../services/reportService";

vi.mock("../../services/evaluationPeriodService", () => ({ evaluationPeriodService: { getEvaluationPeriods: vi.fn() } }));
vi.mock("../../services/evaluationService", () => ({ listEvaluations: vi.fn() }));
vi.mock("../../services/reportService", () => ({ createReport: vi.fn(), listReports: vi.fn(), downloadReport: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

/** Cô lập component bằng phản hồi có cùng hợp đồng, không dùng mock này làm bằng chứng backend chạy
 * Luồng HTTP/PostgreSQL và tải bytes qua Chrome được kiểm ở bộ VC15 riêng
 */
function prepare() {
  evaluationPeriodService.getEvaluationPeriods.mockResolvedValue({ items: [{ id: "period-uuid", name: "Kỳ dữ liệu thật", year: 2026 }], total: 1 });
  listReports.mockResolvedValue({ items: [], total: 0 });
  listEvaluations.mockResolvedValue({ items: [{ id: "evaluation-uuid", unit: { name: "Đơn vị kiểm thử" }, status: "PENDING_REVIEW" }], total: 1 });
}

/** Tạo tổng hợp không gửi evaluationId, giữ trạng thái chờ đến khi server hoàn tất và chặn nhấp lặp */
test("tạo Excel đúng scope và chỉ báo thành công sau khi API hoàn tất", async () => {
  prepare(); let finish;
  createReport.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<MemoryRouter><AdminReports /></MemoryRouter>);
  await waitFor(() => expect(listReports).toHaveBeenCalledWith(expect.objectContaining({ periodId: "period-uuid" })));
  fireEvent.click(screen.getByRole("button", { name: "Tạo báo cáo" }));
  fireEvent.click(screen.getByRole("button", { name: /Tạo báo cáo/u }));
  expect(createReport).toHaveBeenCalledTimes(1);
  expect(createReport).toHaveBeenCalledWith({ periodId: "period-uuid", reportType: "SUMMARY_ALL_UNITS", format: "XLSX" });
  expect(screen.getByText("Đang tạo và lưu tệp báo cáo, vui lòng chờ")).toBeInTheDocument();
  finish({ fileName: "tong-hop.xlsx" });
  await screen.findByText("Đã tạo báo cáo tong-hop.xlsx");
});

/** URL hồ sơ chọn biên bản PDF đúng kỳ, không tự tính hoặc xuất dữ liệu phía FE */
test("biên bản gửi UUID hồ sơ thuộc kỳ đang chọn", async () => {
  prepare(); createReport.mockResolvedValue({ fileName: "bien-ban.pdf" });
  render(<MemoryRouter initialEntries={["/admin/reports?periodId=period-uuid&evaluationId=evaluation-uuid"]}><AdminReports /></MemoryRouter>);
  await screen.findByText("Đơn vị kiểm thử — Chờ duyệt");
  await waitFor(() => expect(screen.getByRole("button", { name: "Tạo báo cáo" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Tạo báo cáo" }));
  await waitFor(() => expect(createReport).toHaveBeenCalledWith({ periodId: "period-uuid", evaluationId: "evaluation-uuid", reportType: "UNIT_APPRAISAL_MINUTES", format: "PDF" }));
});

/** Lỗi tạo và lỗi danh sách không biến thành READY hoặc thông báo thành công giả */
test("hiện lỗi tạo và lỗi lịch sử bằng tiếng Việt", async () => {
  prepare(); listReports.mockRejectedValue(new Error("Không thể tải lịch sử báo cáo"));
  createReport.mockRejectedValue(new Error("Kho tệp chưa sẵn sàng"));
  render(<MemoryRouter><AdminReports /></MemoryRouter>);
  await screen.findByText("Không thể tải lịch sử báo cáo");
  fireEvent.click(screen.getByRole("button", { name: "Tạo báo cáo" }));
  await screen.findByText("Kho tệp chưa sẵn sàng");
  expect(screen.queryByText(/Đã tạo báo cáo/u)).toBeNull();
});
