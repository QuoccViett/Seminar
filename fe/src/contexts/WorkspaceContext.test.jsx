import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { WorkspaceProvider, useRecordDrafts } from "./WorkspaceContext";
import { usePeriodSelection } from "../services/periodSelection";

vi.mock("./AuthContext", () => ({ useAuth: () => ({ user: { id: "nguoi-thu", mustChangePassword: false } }) }));

/** Cô lập bộ nhớ giữa test để không dùng nháp hoặc kỳ của phép thử trước */
afterEach(() => { cleanup(); sessionStorage.clear(); });

/** Mô phỏng ô chưa lưu qua API công khai của hook, không cần dựng lại bảng nghiệp vụ */
function DraftEditor() {
  const [draft, setDraft] = useRecordDrafts("self:ho-so-thu");
  return <input aria-label="Nháp thử" value={draft.note ?? ""} onChange={(event) => setDraft({ note: event.target.value })} />;
}

/** Dựng bộ chọn kỳ tối giản để kiểm thứ tự URL và bộ nhớ phiên qua chuyển trang */
function PeriodChoice() {
  const [periodId, select] = usePeriodSelection();
  return <><span>Kỳ: {periodId}</span><button onClick={() => select("ky-moi")}>Đổi kỳ thử</button><Link to="/bao-cao">Báo cáo thử</Link></>;
}

/** Nháp phải sống qua unmount khi đổi trang và bị xóa tường minh khi phiên đổi mật khẩu */
test("giữ nháp khi chuyển trang và xóa khi đổi phiên", () => {
  render(<MemoryRouter><WorkspaceProvider><Link to="/khac">Đi trang khác</Link><Link to="/">Về hồ sơ</Link><Routes><Route path="/" element={<DraftEditor />} /><Route path="/khac" element={<span>Trang khác</span>} /></Routes></WorkspaceProvider></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Nháp thử"), { target: { value: "Diễn giải chưa lưu" } });
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByText("Đi trang khác")); fireEvent.click(screen.getByText("Về hồ sơ"));
  expect(screen.getByLabelText("Nháp thử")).toHaveValue("Diễn giải chưa lưu");
  fireEvent(window, new CustomEvent("workspace:clear"));
  expect(screen.getByLabelText("Nháp thử")).toHaveValue("");
});

/** URL được ưu tiên, trang khác dùng cùng kỳ đã chọn mà không chép quyền hoặc dữ liệu nghiệp vụ */
test("lựa chọn kỳ theo URL rồi giữ giữa các trang", () => {
  sessionStorage.setItem("selectedPeriodId", "ky-cu");
  render(<MemoryRouter initialEntries={["/?periodId=ky-url"]}><Routes><Route path="/" element={<PeriodChoice />} /><Route path="/bao-cao" element={<PeriodChoice />} /></Routes></MemoryRouter>);
  expect(screen.getByText("Kỳ: ky-url")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Đổi kỳ thử")); fireEvent.click(screen.getByText("Báo cáo thử"));
  expect(screen.getByText("Kỳ: ky-moi")).toBeInTheDocument();
});
