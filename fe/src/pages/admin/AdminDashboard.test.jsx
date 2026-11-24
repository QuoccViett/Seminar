import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import AdminDashboard from "./AdminDashboard";
import { dashboardService } from "../../services/dashboardService";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";

vi.mock("../../services/dashboardService", () => ({ dashboardService: { getDashboardStats: vi.fn(), getLeaderboard: vi.fn(), getScoreDistribution: vi.fn(), getCriteriaDeductions: vi.fn(), getDeductionDetail: vi.fn() } }));
vi.mock("../../services/evaluationPeriodService", () => ({ evaluationPeriodService: { getEvaluationPeriods: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

/** Kiểm giao diện lấy đúng UUID kỳ và hiển thị trạng thái tạm tính từ API
 * Mock chỉ cô lập component; kiểm HTTP/PostgreSQL thật nằm trong vc14.dashboard.test.ts
 */
test("dashboard dùng số liệu API và đánh dấu thứ hạng chưa chốt", async () => {
  evaluationPeriodService.getEvaluationPeriods.mockResolvedValue({ items: [{ id: "period-uuid", name: "Kỳ kiểm thử", year: 2026, publishedAt: "2026-01-01" }] });
  dashboardService.getDashboardStats.mockResolvedValue({ totalUnits: 1, submittedCount: 1, notSubmittedCount: 0, supplementPendingCount: 0, finalizedCount: 0, progressPercent: 100, statusCounts: { PENDING_REVIEW: 1 }, officialResults: { totalFinalScore: 0, averageFinalScore: 0, averageFinalPercent: 0 } });
  dashboardService.getLeaderboard.mockResolvedValue({ totalUnits: 1, items: [{ evaluationId: "eval-uuid", rank: 1, unitName: "Đơn vị API", selfTotal: 80, currentTotal: 80, ratingLabel: "Tốt", ratingColor: "gold", isFinal: false, status: "PENDING_REVIEW" }] });
  dashboardService.getScoreDistribution.mockResolvedValue({ finalizedCount: 0, items: [], buckets: [{ key: "0-50", label: "Dưới 50%", count: 0, percent: 0 }] });
  dashboardService.getCriteriaDeductions.mockResolvedValue({ items: [] });
  render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
  await screen.findByText("Đơn vị API");
  expect(screen.getByText("Tạm tính")).toBeInTheDocument();
  expect(screen.getByText("Tốt")).toBeInTheDocument();
  expect(screen.getByText("Tốt")).not.toHaveClass("ant-tag");
  expect(screen.getByText("Tốt").style.backgroundColor).toBe("");
  await waitFor(() => expect(dashboardService.getLeaderboard).toHaveBeenCalledWith("period-uuid", 20));
});

/** Kỳ rỗng và lỗi mạng là hai trạng thái khác nhau, không được hiển thị số 0 như dữ liệu thật */
test("dashboard phân biệt chưa có kỳ với lỗi tải kỳ", async () => {
  evaluationPeriodService.getEvaluationPeriods.mockResolvedValueOnce({ items: [] });
  const empty = render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
  await screen.findByText("Chưa có kỳ đánh giá");
  expect(dashboardService.getDashboardStats).not.toHaveBeenCalled();
  empty.unmount();
  evaluationPeriodService.getEvaluationPeriods.mockRejectedValueOnce(new Error("Không thể tải danh sách kỳ"));
  render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
  await screen.findByText("Không thể tải danh sách kỳ");
  expect(screen.queryByText("Chưa có kỳ đánh giá")).toBeNull();
});
