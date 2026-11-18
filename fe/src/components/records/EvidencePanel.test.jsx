import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import EvidencePanel from "./EvidencePanel";
import { cancelEvidenceUpload, confirmEvidences, readEvidenceBlob, requestEvidenceUploads, uploadEvidenceBytes } from "../../services/evidenceService";

vi.mock("../../services/evidenceService", () => ({ cancelEvidenceUpload: vi.fn(), confirmEvidences: vi.fn(), deleteEvidence: vi.fn(), readEvidenceBlob: vi.fn(), requestEvidenceUploads: vi.fn(), uploadEvidenceBytes: vi.fn() }));

/** Mỗi test có DOM và service độc lập, mock chỉ kiểm hành vi UI và không thay nghiệm thu HTTP/PG thật */
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const row = { criterionId: "leaf", code: "MC1", canEditSelf: true, allowFile: true, allowLink: true, evidences: [] };

/** Hai tệp cùng lượt có thể khác kết quả, tiến độ 100 không được báo trước confirm
 * Khi confirm bị từ chối do hết hạn, UI giữ câu lỗi từng tệp và hủy đúng reservation lỗi
 */
test("tải nhiều tệp giữ kết quả riêng và chỉ thành công sau xác nhận", { timeout: 60000 }, async () => {
  requestEvidenceUploads.mockResolvedValueOnce({ results: [{ ok: true, data: { uploadId: "upload-1" } }] }).mockResolvedValueOnce({ results: [{ ok: true, data: { uploadId: "upload-2" } }] });
  uploadEvidenceBytes.mockImplementation(async (_, __, progress) => progress(99));
  confirmEvidences.mockResolvedValueOnce({ results: [{ ok: true, data: { id: "file-1" } }] }).mockResolvedValueOnce({ results: [{ ok: false, error: { message: "Đã hết thời gian tự chấm" } }] });
  cancelEvidenceUpload.mockResolvedValue({});
  const onReload = vi.fn(); const onBusyChange = vi.fn();
  const { container } = render(<EvidencePanel evaluationId="evaluation" row={row} onReload={onReload} onBusyChange={onBusyChange} />);
  const files = [new File(["PDF"], "Báo cáo.pdf", { type: "application/pdf" }), new File(["PNG"], "Hoạt động.png", { type: "image/png" })];
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files } });
  await waitFor(() => expect(confirmEvidences).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Báo cáo.pdf: Đã gắn minh chứng")).toBeInTheDocument();
  expect(await screen.findByText("Hoạt động.png: Đã hết thời gian tự chấm")).toBeInTheDocument();
  expect(cancelEvidenceUpload).toHaveBeenCalledWith("evaluation", "upload-2");
  expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(onReload).toHaveBeenCalled();
});

/** Snapshot BE khóa thì không có vùng tải/link/xóa, Word chỉ tải và PDF có xem trước
 * Không thay giờ máy để quyết định quyền, chỉ thay canEditSelf từ response
 */
test("quyền server khóa thao tác ghi và Word chỉ tải xuống", { timeout: 60000 }, async () => {
  render(<EvidencePanel evaluationId="evaluation" row={{ ...row, canEditSelf: false, evidences: [{ id: "word", kind: "FILE", round: "INITIAL", fileName: "Biên bản.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", canDelete: false }, { id: "pdf", kind: "FILE", round: "SUPPLEMENT", fileName: "Báo cáo.pdf", mimeType: "application/pdf", canDelete: false }] }} />);
  expect(screen.queryByText("Kéo thả hoặc chọn nhiều tệp minh chứng")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Thêm liên kết" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Xóa" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Xem trước" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Tải xuống" })).toHaveLength(2);
  readEvidenceBlob.mockRejectedValue(new Error("Liên kết tệp đã hết hạn"));
  fireEvent.click(screen.getByRole("button", { name: "Xem trước" }));
  expect(await screen.findByText("Liên kết tệp đã hết hạn")).toBeInTheDocument();
});
