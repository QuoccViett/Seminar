import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal, message } from "antd";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AdminConfig from "./AdminConfig";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { criteriaService } from "../../services/criteriaService";

// Giữ Ant Form/Modal/input/validator thật; thu gọn bảng và điều hướng để JSDOM
// không phải đo layout của các tab ẩn. Kiểm browser của repo chịu trách nhiệm layout.
vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual,
    Tabs: ({ items, activeKey, onChange }) => <>
      <div role="tablist">{items.map((item) => <button key={item.key} role="tab" aria-selected={item.key === activeKey} disabled={item.disabled} onClick={() => onChange(item.key)}>{item.label}</button>)}</div>
      <div role="tabpanel">{items.find((item) => item.key === activeKey)?.children}</div>
    </>,
    Table: ({ columns, dataSource }) => {
      const rows = (nodes) => nodes.flatMap((node) => [node, ...rows(node.children || [])]);
      return <div>{rows(dataSource).map((row) => <div key={row.id}>{columns.map((column) => <span key={column.key}>{column.render ? column.render(row[column.dataIndex], row) : row[column.dataIndex]}</span>)}</div>)}</div>;
    },
  };
});

vi.mock("../../services/evaluationPeriodService", () => ({ evaluationPeriodService: {
  getEvaluationPeriods: vi.fn(), updateEvaluationPeriod: vi.fn(), createEvaluationPeriod: vi.fn(), saveThresholds: vi.fn(),
} }));
vi.mock("../../services/criteriaService", () => ({ criteriaService: { getCriteria: vi.fn(), createCriteria: vi.fn(), updateCriteria: vi.fn() } }));

const period = { id: "period", name: "Kỳ kiểm thử", year: 2027, phase: "SETUP", maxTotalScore: 10, publishedAt: null, selfEvalStart: "2099-11-28T03:00:00Z", selfEvalDeadline: "2099-11-28T05:00:00Z" };
const child = { id: "child", code: "1.1", name: "Tiêu chí con", parentId: "parent", maxScore: 6, sortOrder: 1 };
const tree = [{ id: "parent", code: "1", name: "Tiêu chí cha", parentId: null, maxScore: 10, sortOrder: 1, children: [child] }];

beforeEach(() => {
  evaluationPeriodService.getEvaluationPeriods.mockResolvedValue({ items: [period], total: 1 });
  evaluationPeriodService.updateEvaluationPeriod.mockResolvedValue(period);
  evaluationPeriodService.saveThresholds.mockResolvedValue([]);
  criteriaService.getCriteria.mockResolvedValue(tree);
});
afterEach(() => { Modal.destroyAll(); message.destroy(); cleanup(); vi.resetAllMocks(); });

test("bấm lưu kỳ có lịch quá khứ hiện lỗi ngay và không chuyển sang tiêu chí", async () => {
  evaluationPeriodService.getEvaluationPeriods.mockResolvedValue({ items: [{ ...period, selfEvalStart: "2001-11-28T03:00:00Z" }], total: 1 });
  render(<AdminConfig />);
  fireEvent.click(await screen.findByRole("button", { name: /Cấu hình/u }));
  fireEvent.click(await screen.findByRole("button", { name: /Lưu và chuyển sang Tiêu chí/u }));
  expect(await screen.findByText("Thời gian bắt đầu phải sau thời gian hiện tại")).toBeInTheDocument();
  expect(evaluationPeriodService.updateEvaluationPeriod).not.toHaveBeenCalled();
  expect(evaluationPeriodService.createEvaluationPeriod).not.toHaveBeenCalled();
  expect(screen.getByRole("tab", { name: "2. Thông tin kỳ thi" })).toHaveAttribute("aria-selected", "true");
});

async function openCriteria() {
  render(<AdminConfig />);
  fireEvent.click(await screen.findByRole("button", { name: /Cấu hình/u }));
  await waitFor(() => expect(criteriaService.getCriteria).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("tab", { name: "3. Tiêu chí chấm điểm" }));
  await screen.findByRole("button", { name: /Thêm tiêu chí/u });
}

test("form thêm chặn tổng điểm vượt cha tại nút lưu và giữ modal để sửa", async () => {
  await openCriteria();
  fireEvent.click(screen.getByRole("button", { name: /Thêm tiêu chí/u }));
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Mã tiêu chí"), { target: { value: "1.2" } });
  fireEvent.change(dialog.getByLabelText("Tên tiêu chí"), { target: { value: "Con mới" } });
  fireEvent.change(dialog.getByLabelText("Điểm tối đa"), { target: { value: "5" } });
  fireEvent.mouseDown(dialog.getByLabelText("Tiêu chí cha"));
  fireEvent.click(await screen.findByText("1 — Tiêu chí cha"));
  fireEvent.click(dialog.getByRole("button", { name: "Lưu tiêu chí" }));
  expect(await dialog.findByText("Tổng điểm tối đa các tiêu chí con không được vượt điểm tối đa của tiêu chí cha")).toBeInTheDocument();
  expect(criteriaService.createCriteria).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("form sửa chặn điểm con vượt cha tại lưu, cho phép sửa về điểm hợp lệ", async () => {
  await openCriteria();
  fireEvent.click(await screen.findByRole("button", { name: "Sửa tiêu chí 1.1" }));
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Điểm tối đa"), { target: { value: "11" } });
  fireEvent.click(dialog.getByRole("button", { name: "Lưu tiêu chí" }));
  expect(await dialog.findByText("Điểm tối đa của tiêu chí con không được lớn hơn điểm tối đa của tiêu chí cha")).toBeInTheDocument();
  expect(criteriaService.updateCriteria).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText("Điểm tối đa"), { target: { value: "10" } });
  fireEvent.click(dialog.getByRole("button", { name: "Lưu tiêu chí" }));
  await waitFor(() => expect(criteriaService.updateCriteria).toHaveBeenCalledWith("period", "child", expect.objectContaining({ maxScore: 10, parentId: "parent" })));
});
