import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import FeedbackPanel from "./FeedbackPanel";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

/** Chuẩn bị response component để kiểm nháp/hiển thị, nghiệm thu HTTP thật nằm ở bộ VC13
 * Nội dung có thẻ cố ý đi qua React text nhằm chứng minh không dùng dangerouslySetInnerHTML
 */
function setup(canPost = true) {
  apiClient.get.mockImplementation(async (path) => path.endsWith("status-history") ? { items: [{ id: "history", actorName: "Hệ thống", fromStatus: "DRAFT", toStatus: "PENDING_REVIEW", createdAt: "2026-11-18T00:00:00Z" }], total: 1 } : { items: [{ id: "feedback", authorName: "Người phản hồi", type: "GENERAL", content: "<b>Chỉ là văn bản</b>", createdAt: "2026-11-18T00:00:00Z" }], total: 1, canPost, allowedTypes: canPost ? ["UNIT_REPLY"] : [], lockedReason: canPost ? null : "Hồ sơ đã chốt" });
}

/** Lỗi 429 giữ nháp và câu tiếng Việt kể cả sau tải lại quyền, lần gửi sau thành công mới xóa */
test("giữ nháp khi gửi lỗi và dùng loại do server cho phép", async () => {
  setup(); apiClient.post.mockRejectedValueOnce(new Error("Bạn gửi phản hồi quá nhanh"));
  render(<FeedbackPanel evaluationId="record" status="PENDING_REVIEW" />);
  const input = await screen.findByLabelText("Nội dung phản hồi"); fireEvent.change(input, { target: { value: "Đơn vị giải trình có dấu" } }); fireEvent.click(screen.getByText("Gửi phản hồi"));
  await screen.findByText("Bạn gửi phản hồi quá nhanh"); await waitFor(() => expect(screen.getByLabelText("Nội dung phản hồi")).toHaveValue("Đơn vị giải trình có dấu"));
  expect(apiClient.post).toHaveBeenCalledWith("/evaluations/record/feedback", { type: "UNIT_REPLY", content: "Đơn vị giải trình có dấu" });
  apiClient.post.mockResolvedValue({ id: "new" }); fireEvent.click(screen.getByText("Gửi phản hồi"));
  await screen.findByText("Đã gửi phản hồi"); await waitFor(() => expect(screen.getByLabelText("Nội dung phản hồi")).toHaveValue(""));
});

/** Chốt chỉ cho đọc timeline và không thực thi HTML của bản ghi cũ */
test("sau chốt chỉ đọc, nội dung được render văn bản", async () => {
  setup(false); const view = render(<FeedbackPanel evaluationId="record" status="FINALIZED" />);
  await screen.findByText("<b>Chỉ là văn bản</b>"); expect(screen.queryByLabelText("Nội dung phản hồi")).toBeNull(); expect(view.container.querySelector("b")).toBeNull();
  expect(await screen.findByText(/Hệ thống/)).toBeInTheDocument();
});
