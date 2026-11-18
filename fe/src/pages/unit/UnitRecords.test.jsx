import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import UnitRecords from "./UnitRecords";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { criteriaService } from "../../services/criteriaService";

vi.mock("../../services/evaluationPeriodService", () => ({ evaluationPeriodService: { getEvaluationPeriods: vi.fn() } }));
vi.mock("../../services/criteriaService", () => ({ criteriaService: { getCriteria: vi.fn() } }));

/** Kiểm quyền hiển thị theo phản hồi API thay vì đồng hồ máy khách
 * Lần đầu API cho biết kỳ chưa mở, lần làm mới sau đó API cho biết đã mở
 * Chỉ lần thứ hai được gọi lấy cây và hiển thị tiêu chí mà không đăng nhập lại
 * Phép thử giao diện này dùng service giả và không thay thế kiểm thử backend thật
 */
test("UNIT chỉ tải tiêu chí sau khi máy chủ xác nhận được xem", async () => {
  const period = { id: "period-1", name: "Kỳ kiểm thử", selfEvalStart: "2026-11-24T17:00:00Z", selfEvalDeadline: "2026-11-28T17:00:00Z", serverTime: "2026-11-24T16:00:00Z", selfEvalState: "NOT_OPEN_YET", criteriaVisible: false };
  evaluationPeriodService.getEvaluationPeriods.mockReset().mockResolvedValueOnce({ items: [period] }).mockResolvedValueOnce({ items: [{ ...period, criteriaVisible: true, selfEvalState: "OPEN" }] });
  criteriaService.getCriteria.mockReset().mockResolvedValue([{ id: "leaf", code: "1", name: "Tiêu chí đã mở", maxScore: 300, children: [] }]);
  render(<UnitRecords />);
  expect(await screen.findByText("Kỳ đánh giá chưa đến giờ mở tiêu chí")).toBeInTheDocument();
  expect(criteriaService.getCriteria).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Làm mới/u }));
  expect(await screen.findByText("Tiêu chí đã mở")).toBeInTheDocument();
  await waitFor(() => expect(criteriaService.getCriteria).toHaveBeenCalledWith("period-1"));
});
