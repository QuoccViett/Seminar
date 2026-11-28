import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ReviewCard from "./ReviewCard";
import { reviewScores } from "../../services/evaluationService";

vi.mock("../../services/evaluationService", () => ({ reviewScores: vi.fn(), acceptAllScores: vi.fn(), completeFirstReview: vi.fn(), requestSupplement: vi.fn() }));
vi.mock("./EvidencePanel", () => ({ default: () => <span>Minh chứng chỉ đọc</span> }));

/** JSDOM không có đo kích thước thật, observer giả chỉ phục vụ Ant Table và DatePicker trong unit test */
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    /** Không đo layout trong unit test, tương tác và giá trị input vẫn dùng DOM thật của JSDOM */
    observe() { /* Không phát sự kiện layout trong môi trường không có bộ dựng trang */ }
    /** Ngừng theo dõi không có tài nguyên ngoài cần giải phóng trong observer giả */
    unobserve() { /* Chỉ giữ giao diện tương thích với Ant */ }
    /** Kết thúc observer giả không tác động component hoặc dữ liệu kiểm thử */
    disconnect() { /* Không có subscription thật */ }
  });
});
/** Mỗi test có DOM và clock riêng để test lỗi không làm rò trạng thái sang trường hợp tiếp theo */
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
/** Trả lại API global sau tệp kiểm thử, không thay thế ResizeObserver của browser thật */
afterAll(() => { vi.unstubAllGlobals(); });

/** Dựng snapshot công khai cho test giao diện độc lập, không thay bằng chứng tích hợp backend thật
 * Hai lá ban đầu chưa có Admin để kiểm giá trị mặc định self và giữ nháp của mục lỗi
 */
function record() {
  return { id: "evaluation", unit: { name: "Đơn vị kiểm thử" }, period: { name: "Kỳ kiểm thử", phase: "FIRST_REVIEW" }, status: "PENDING_REVIEW", permissions: { canReview: true, canCompleteFirstReview: true }, criteria: ["A", "B"].map((code) => ({ criterionId: code, code, name: `Tiêu chí ${code}`, maxScore: 60, selfScore: 50, selfNote: "Ban đầu", adminScore: null, adminComment: null, children: [] })) };
}

describe("thẩm định giữ nháp và quyền từ backend", () => {
  it("chỉ cho xem trước chốt khi kỳ đến thẩm định cuối", () => {
    const snapshot = record(); const onFinalize = vi.fn();
    const props = { summary: {}, onReload: vi.fn(), onBusyChange: vi.fn(), onFinalize };
    const view = render(<ReviewCard {...props} record={snapshot} />);
    const button = screen.getByRole("button", { name: "Xem trước và chốt hồ sơ" });
    for (const phase of ["SETUP", "SELF_EVAL", "FIRST_REVIEW", "SUPPLEMENT", "CLOSED"]) {
      view.rerender(<ReviewCard {...props} record={{ ...snapshot, period: { ...snapshot.period, phase } }} />);
      expect(button).toBeDisabled();
    }
    view.rerender(<ReviewCard {...props} record={{ ...snapshot, period: { ...snapshot.period, phase: "FINAL_REVIEW" } }} />);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onFinalize).toHaveBeenCalledWith([snapshot.id]);
  });
  /** Màn chốt dùng nhãn tùy chỉnh của kỳ, không in mã GOOD hoặc lấy nhãn tự chấm */
  it("hiển thị xếp loại chính thức theo cấu hình kỳ", () => {
    const snapshot = { ...record(), finalResult: { score: 75, percent: 75, rating: "GOOD" } };
    render(<ReviewCard record={snapshot} summary={{ selfTotal: 90, maxTotalScore: 100, ratingLabel: "Xuất sắc" }} ratingThresholds={[{ rating: "GOOD", label: "Hoàn thành tốt nhiệm vụ" }]} onReload={vi.fn()} onBusyChange={vi.fn()} onFinalize={vi.fn()} />);
    expect(screen.getByText("Đã chốt: 75 điểm · 75% · Hoàn thành tốt nhiệm vụ")).toBeInTheDocument();
    expect(screen.queryByText(/\bGOOD\b/u)).toBeNull();
  });
  /** Một ô thành công không được xóa nháp của ô lỗi khi parent tải snapshot mới
   * Polling đổi record object nhưng cùng id phải giữ nháp cho tới khi người dùng lưu thành công
   */
  it("giữ ô lỗi sau batch và sau khi tải snapshot mới", { timeout: 60000 }, async () => {
    const initial = record(); const reload = vi.fn();
    const props = { summary: { selfTotal: 100, maxTotalScore: 120 }, onReload: reload, onBusyChange: vi.fn(), onFinalize: vi.fn() };
    reviewScores.mockResolvedValue({ results: [{ criterionId: "A", ok: true }, { criterionId: "B", ok: false, error: { message: "Cần nhập lý do thẩm định" } }] });
    const view = render(<ReviewCard {...props} record={initial} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Điểm thẩm định A", exact: true }), { target: { value: "49" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Điểm thẩm định B", exact: true }), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu tất cả thẩm định", exact: true }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    view.rerender(<ReviewCard {...props} record={{ ...initial, criteria: initial.criteria.map((row) => row.code === "A" ? { ...row, adminScore: 49 } : row) }} />);
    expect(screen.getByRole("spinbutton", { name: "Điểm thẩm định A", exact: true })).toHaveValue("49.00");
    expect(screen.getByRole("spinbutton", { name: "Điểm thẩm định B", exact: true })).toHaveValue("48.00");
    expect(screen.getByText("Cần nhập lý do thẩm định")).toBeInTheDocument();
  });

  /** Giao diện không tự mở lại thao tác khi đồng hồ máy sai mà server đã trả quyền khóa */
  it("khóa thao tác theo cờ server dù giờ máy bị thay đổi", () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    const snapshot = record(); snapshot.permissions.canReview = false;
    render(<ReviewCard record={snapshot} summary={{}} onReload={vi.fn()} onBusyChange={vi.fn()} onFinalize={vi.fn()} />);
    expect(screen.getByRole("spinbutton", { name: "Điểm thẩm định A", exact: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Chấp nhận các ô chưa duyệt", exact: true })).toBeDisabled();
  });
});
