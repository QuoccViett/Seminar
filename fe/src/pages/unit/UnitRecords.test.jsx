import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import UnitRecords from "./UnitRecords";
import SelfEvaluationCard from "../../components/records/SelfEvaluationCard";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { getEvaluation, getScoreSummary, listEvaluations, saveSelfScores, submitEvaluation } from "../../services/evaluationService";

vi.mock("../../services/evaluationPeriodService", () => ({ evaluationPeriodService: { getEvaluationPeriods: vi.fn() } }));
vi.mock("../../services/evaluationService", () => ({ createEvaluation: vi.fn(), getEvaluation: vi.fn(), getScoreSummary: vi.fn(), listEvaluations: vi.fn(), saveSelfScores: vi.fn(), submitEvaluation: vi.fn() }));
// Cô lập trao đổi để test trang chỉ kiểm quyền tự chấm, FeedbackPanel có bộ test và nghiệm thu HTTP riêng
vi.mock("../../components/records/FeedbackPanel", () => ({ default: () => null }));

/** JSDOM không có ResizeObserver, adapter rỗng chỉ thay API đo bố cục trình duyệt
 * Không giả nghiệp vụ hoặc quyền, ba phương thức nhận/bỏ theo dõi mà không phát sự kiện kích thước
 * Cleanup tường minh vì runner không bật globals, mỗi test phải có DOM riêng để tránh đọc thẻ cũ
 */
beforeAll(() => { vi.stubGlobal("ResizeObserver", class {
  /** Nhận phần tử cần theo dõi, JSDOM không tính bố cục nên không tạo callback giả */
  observe() {}
  /** Bỏ một phần tử theo dõi, không có tài nguyên bố cục cần giải phóng trong JSDOM */
  unobserve() {}
  /** Kết thúc observer khi unmount, không tác động service hoặc dữ liệu của phép thử */
  disconnect() {}
}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

/** Chuẩn bị snapshot hồ sơ/summary API cho phép thử component, không thay nghiệm thu backend thật
 * Dữ liệu mặc định có một lá được sửa, test có thể đổi snapshot quyền mà không đổi giờ thiết bị
 */
function setup() {
  // Các ca này làm mới bằng nút có chủ đích, tắt interval nền để số request không đổi khi JSDOM dựng bảng chậm
  // Timer chỉ bị thay ở biên browser của unit test, kiểm đồng bộ quyền/focus/mốc giờ thật nằm trong browser E2E
  vi.spyOn(globalThis, "setInterval").mockImplementation(() => 0);
  const period = { id: "period-1", name: "Kỳ kiểm thử", selfEvalStart: "2026-11-24T17:00:00Z", selfEvalDeadline: "2026-11-28T17:00:00Z", serverTime: "2026-11-24T16:00:00Z", criteriaVisible: true };
  const record = { id: "evaluation-1", status: "DRAFT", period, criteriaVisible: true, canSubmit: true, criteria: [{ criterionId: "leaf", code: "1", name: "Tiêu chí đã mở", maxScore: 300, children: [], canEditSelf: true, selfScore: null, selfNote: null, allowText: true }] };
  evaluationPeriodService.getEvaluationPeriods.mockReset().mockResolvedValue({ items: [period] });
  listEvaluations.mockReset().mockResolvedValue({ items: [{ id: record.id }], total: 1 });
  getEvaluation.mockReset().mockImplementation(async () => structuredClone(record));
  getScoreSummary.mockReset().mockResolvedValue({ selfTotal: 0, maxTotalScore: 300, selfPercent: 0, ratingLabel: "Chưa đạt", scoredCount: 0, leafCount: 1 });
  saveSelfScores.mockReset(); submitEvaluation.mockReset();
  return { period, record };
}

/** Bộ đếm chỉ refetch một lần khi vượt hạn của snapshot còn mở, không lặp request sau snapshot đã khóa
 * Điều khiển performance và callback interval ở biên browser, không thay giờ hệ thống hoặc quyền server
 * Rerender với serverTime mới đã quá hạn phải giữ số lần hỏi lại, tránh vòng lặp HTTP sau hết giờ
 */
test("countdown không refetch vô hạn khi backend đã xác nhận quá hạn", () => {
  const callbacks = [];
  vi.spyOn(globalThis, "setInterval").mockImplementation((callback) => { callbacks.push(callback); return 0; });
  const monotonic = vi.spyOn(performance, "now").mockReturnValue(0);
  const onReload = vi.fn();
  const period = { name: "Kỳ thử bộ đếm", selfEvalDeadline: "2026-11-18T10:00:01Z" };
  const record = { id: "countdown", status: "DRAFT", serverTime: "2026-11-18T10:00:00Z", period, criteria: [], criteriaVisible: false };
  const view = render(<SelfEvaluationCard period={period} record={record} onReload={onReload} />);
  expect(onReload).not.toHaveBeenCalled();
  act(() => { monotonic.mockReturnValue(1500); callbacks[0](); callbacks[0](); });
  expect(onReload).toHaveBeenCalledTimes(1);
  view.rerender(<SelfEvaluationCard period={period} record={{ ...record, serverTime: "2026-11-18T10:00:02Z" }} onReload={onReload} />);
  expect(onReload).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Thời gian đến hạn tự chấm: khoảng 0 phút/u)).toBeInTheDocument();
});

/** Kiểm quyền hiển thị theo phản hồi API thay vì đồng hồ máy khách
 * Lần đầu API cho biết kỳ chưa mở, lần làm mới sau đó API cho biết đã mở
 * Chỉ lần thứ hai được gọi lấy cây và hiển thị tiêu chí mà không đăng nhập lại
 * Phép thử giao diện này dùng service giả và không thay thế kiểm thử backend thật
 */
test("UNIT chỉ hiện tiêu chí và tải summary sau khi máy chủ xác nhận được xem", async () => {
  const { record } = setup();
  getEvaluation.mockResolvedValueOnce({ ...record, criteriaVisible: false, criteria: [] });
  render(<UnitRecords />);
  expect(await screen.findByText("Kỳ đánh giá chưa đến giờ mở tiêu chí")).toBeInTheDocument();
  expect(getScoreSummary).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Làm mới/u }));
  expect(await screen.findByText("Tiêu chí đã mở")).toBeInTheDocument();
  await waitFor(() => expect(getScoreSummary).toHaveBeenCalledWith("evaluation-1"));
});

/** Kiểm refresh không xóa nháp và nộp bị chặn khi chưa lưu, tổng hiển thị chỉ từ summary API
 * Sau lưu thành công server khóa quyền, component không tự mở lại input theo giờ máy
 * Ngân sách 120 giây dành cho Table/InputNumber trong JSDOM trên máy thiếu RAM, vẫn kiểm mọi assertion
 */
test("giữ nháp qua refresh, lưu bằng API rồi nhận tổng và quyền từ server", { timeout: 120000 }, async () => {
  const { record } = setup();
  saveSelfScores.mockImplementation(async () => {
    record.criteria[0].selfScore = 8; record.criteria[0].canEditSelf = false; record.canSubmit = false;
    getScoreSummary.mockResolvedValue({ selfTotal: 8, maxTotalScore: 300, selfPercent: 2.67, ratingLabel: "Chưa đạt", scoredCount: 1, leafCount: 1 });
    return { results: [{ criterionId: "leaf", ok: true }] };
  });
  render(<UnitRecords />);
  const input = await screen.findByRole("spinbutton", { name: "Điểm 1" });
  fireEvent.change(input, { target: { value: "8" } });
  expect(screen.getByRole("button", { name: "Nộp hồ sơ" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Làm mới/u }));
  await waitFor(() => expect(getEvaluation).toHaveBeenCalledTimes(2));
  // InputNumber định dạng precision=2 khi mất focus, kiểm đúng bản nháp thay vì bỏ qua định dạng
  expect(screen.getByRole("spinbutton", { name: "Điểm 1" })).toHaveValue("8.00");
  fireEvent.click(screen.getByRole("button", { name: "Lưu tiêu chí 1" }));
  expect(await screen.findByText("Đã lưu điểm và diễn giải")).toBeInTheDocument();
  expect(saveSelfScores).toHaveBeenCalledWith("evaluation-1", [{ criterionId: "leaf", selfScore: 8, selfNote: null }]);
  expect(await screen.findByText(/Tổng tự chấm tạm tính: 8\/300/u)).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "Điểm 1" })).toBeDisabled();
});

/** Lỗi từng ô giữ bản nháp, nộp qua xác nhận hiển thị thành công sau API thật đã phản hồi
 * Service giả chỉ phục vụ UI test, HTTP/PG và trình duyệt thật được ghi bằng chứng riêng
 * Ngân sách 120 giây bao gồm render bảng và popup trên máy thiếu RAM, không bỏ qua lỗi chức năng
 */
test("lỗi từng ô không xóa nháp và nộp thành công chỉ sau xác nhận API", { timeout: 120000 }, async () => {
  const { record } = setup();
  saveSelfScores.mockResolvedValueOnce({ results: [{ criterionId: "leaf", ok: false, error: { message: "Điểm không hợp lệ" } }] }).mockResolvedValueOnce({ results: [{ criterionId: "leaf", ok: true }] });
  submitEvaluation.mockImplementation(async () => { record.status = "PENDING_REVIEW"; record.canSubmit = false; record.criteria[0].canEditSelf = false; });
  render(<UnitRecords />);
  fireEvent.change(await screen.findByRole("spinbutton", { name: "Điểm 1" }), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu tiêu chí 1" }));
  expect(await screen.findByText("Điểm không hợp lệ")).toBeInTheDocument();
  // Số 0 vẫn được giữ và hiển thị hai chữ số, không bị coi là ô chưa nhập sau lỗi lưu
  expect(screen.getByRole("spinbutton", { name: "Điểm 1" })).toHaveValue("0.00");
  fireEvent.click(screen.getByRole("button", { name: "Lưu tiêu chí 1" }));
  await screen.findByText("Đã lưu điểm và diễn giải");
  await waitFor(() => expect(screen.getByRole("button", { name: "Nộp hồ sơ" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Nộp hồ sơ" }));
  expect(submitEvaluation).not.toHaveBeenCalled();
  fireEvent.click((await screen.findAllByRole("button", { name: "Nộp hồ sơ" }))[1]);
  expect(await screen.findByText("Đã nộp hồ sơ, nội dung tự chấm đã khóa chỉnh sửa")).toBeInTheDocument();
  expect(submitEvaluation).toHaveBeenCalledWith("evaluation-1");
});
