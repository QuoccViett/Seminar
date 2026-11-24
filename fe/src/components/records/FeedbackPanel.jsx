import { useCallback, useEffect, useRef, useState } from "react";
import { EVALUATION_STATUS_LABELS, FEEDBACK_TYPE_LABELS, displayLabel } from "../../services/displayLabels";
import { Alert, Button, Card, Empty, Input, Pagination, Select, Space, Timeline, Typography } from "antd";
import apiClient from "../../services/apiClient";
import { useRecordDrafts } from "../../contexts/WorkspaceContext";

const typeLabels = FEEDBACK_TYPE_LABELS;
const statusLabels = { ...EVALUATION_STATUS_LABELS, PENDING_REVIEW: "Chờ thẩm định", SUPPLEMENT_REQUESTED: "Yêu cầu bổ sung", SUPPLEMENT_EXPIRED: "Hết hạn bổ sung" };

/** Đổi ghi chú trạng thái mẫu có mã kỹ thuật thành câu dễ đọc cho người dùng */
function historyComment(value) {
  if (!value) return "";
  const sampleTransition = value.match(/^Chuyển trạng thái mẫu sang\s+([A-Z_]+)\.?$/u);
  if (sampleTransition) return `Hồ sơ chuyển sang trạng thái ${displayLabel(statusLabels, sampleTransition[1], "chưa xác định")}.`;
  return value.replace(/\b(DRAFT|SUBMITTED|PENDING_REVIEW|SUPPLEMENT_REQUESTED|SUPPLEMENT_SUBMITTED|SUPPLEMENT_EXPIRED|FINALIZED)\b/gu, (code) => statusLabels[code] ?? code);
}

/** Hiển thị mốc giờ Việt Nam cố định, không dùng giờ máy để cấp quyền gửi */
function time(value) { return new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }); }

/** Đọc trao đổi và timeline từ backend thật cho cả hai vai trò
 * Quyền gửi/loại gửi lấy từ server, văn bản chỉ render qua React để không thực thi HTML
 * Nháp giữ khi lỗi gửi, kết quả tải muộn bị hủy khi đổi hồ sơ hoặc trang
 */
export default function FeedbackPanel({ evaluationId, status }) {
  const [feedback, setFeedback] = useState(null); const [history, setHistory] = useState(null);
  const [page, setPage] = useState(1); const [historyPage, setHistoryPage] = useState(1);
  const [draft, setDraft] = useRecordDrafts(`feedback:${evaluationId}`);
  const content = draft.content ?? "";
  const setContent = (value) => setDraft(value ? { content: value } : {});
  const [type, setType] = useState();
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [sendError, setSendError] = useState("");
  const [loading, setLoading] = useState(false); const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0); const busy = useRef(false);

  /** Tải hai trang bằng cùng identity phiên, chỉ cập nhật khi effect vẫn còn hiệu lực
   * Khi lỗi xóa quyền gửi cũ để tránh dùng snapshot đã lỗi thời, nút thử lại có chủ đích
   */
  useEffect(() => {
    let active = true; setLoading(true);
    Promise.all([apiClient.get(`/evaluations/${evaluationId}/feedback`, { params: { page, pageSize: 10 } }), apiClient.get(`/evaluations/${evaluationId}/status-history`, { params: { page: historyPage, pageSize: 10 } })])
      .then(([messages, events]) => { if (active) { setFeedback(messages); setHistory(events); setError(""); } })
      .catch((failure) => { if (active) { setFeedback(null); setHistory(null); setError(failure.message || "Không thể tải trao đổi và lịch sử hồ sơ"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [evaluationId, status, page, historyPage, refresh]);

  /** Chặn double click tại client để giảm gửi nhầm, backend vẫn kiểm spam và quyền lần nữa
   * Chỉ xóa nháp sau HTTP thành công, lỗi 429/khóa giữ nội dung để người dùng xử lý
   */
  const send = useCallback(async () => {
    if (busy.current || !content.trim() || !feedback?.canPost) return;
    busy.current = true; setSending(true); setNotice(""); setSendError("");
    try {
      await apiClient.post(`/evaluations/${evaluationId}/feedback`, { type: type || feedback.allowedTypes[0], content });
      setContent(""); setNotice("Đã gửi phản hồi"); setPage(1); setRefresh((value) => value + 1);
    } catch (failure) {
      // Lỗi validation như nội dung có thẻ HTML cần nêu chi tiết để người dùng sửa đúng ô
      // Giữ nháp và tải lại quyền sau từ chối, không ghi đè nội dung bằng snapshot server
      setSendError([failure.message || "Không thể gửi phản hồi", ...(failure.fieldErrors ?? []).flatMap((item) => item.messages)].join("; "));
      setRefresh((value) => value + 1);
    }
    finally { busy.current = false; setSending(false); }
  }, [content, evaluationId, feedback, type]);

  return <Card title="Trao đổi và lịch sử hồ sơ" loading={loading} extra={<Button disabled={sending} onClick={() => setRefresh((value) => value + 1)}>Tải lại trao đổi</Button>}>
    <Space orientation="vertical" style={{ width: "100%" }}>
      {error && <Alert type="error" title={error} showIcon />}
      {sendError && <Alert id={`feedback-error-${evaluationId}`} type="error" title={sendError} showIcon />}
      {notice && <Alert type="success" title={notice} showIcon />}
      {feedback && <>
        {feedback.items.length === 0 && <Empty description="Chưa có phản hồi" />}
        {feedback.items.map((item) => <Card key={item.id} size="small" title={`${item.authorName} · ${displayLabel(typeLabels, item.type, "Trao đổi hồ sơ")}`} extra={time(item.createdAt)}><Typography.Paragraph style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.content}</Typography.Paragraph></Card>)}
        <Pagination current={page} pageSize={10} total={feedback.total} showSizeChanger={false} onChange={setPage} />
        {feedback.lockedReason && <Alert type="info" title={feedback.lockedReason} />}
        {feedback.canPost && <>
          <Select aria-label="Loại phản hồi" value={type || feedback.allowedTypes[0]} options={feedback.allowedTypes.map((value) => ({ value, label: displayLabel(typeLabels, value, "Trao đổi hồ sơ") }))} onChange={setType} disabled={sending} style={{ width: 240 }} />
          <Input.TextArea aria-label="Nội dung phản hồi" aria-invalid={Boolean(sendError)} aria-describedby={sendError ? `feedback-error-${evaluationId}` : undefined} status={sendError ? "error" : undefined} value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} showCount disabled={sending} />
          <Typography.Text type="secondary">Văn bản thuần, tối đa 4000 ký tự · Mỗi lần cách 30 giây, tối đa 20 phản hồi mỗi giờ</Typography.Text>
          <Button type="primary" loading={sending} disabled={!content.trim() || sending} onClick={send}>Gửi phản hồi</Button>
        </>}
      </>}
      <Typography.Title level={5}>Lịch sử trạng thái</Typography.Title>
      {history && (history.items.length ? <Timeline items={history.items.map((item) => ({ key: item.id, content: <Space orientation="vertical"><Typography.Text>{item.fromStatus ? displayLabel(statusLabels, item.fromStatus, "Trạng thái trước đó") : "Khởi tạo"} → {displayLabel(statusLabels, item.toStatus, "Trạng thái chưa xác định")}</Typography.Text><Typography.Text>{item.actorName} · {time(item.createdAt)}</Typography.Text>{item.comment && <Typography.Text style={{ whiteSpace: "pre-wrap" }}>{historyComment(item.comment)}</Typography.Text>}</Space> }))} /> : <Empty description="Chưa có thay đổi trạng thái" />)}
      {history && <Pagination current={historyPage} pageSize={10} total={history.total} showSizeChanger={false} onChange={setHistoryPage} />}
    </Space>
  </Card>;
}
