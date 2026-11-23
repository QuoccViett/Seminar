import { useEffect, useRef, useState } from "react";
import FeedbackPanel from "./FeedbackPanel";
import { Alert, Button, Card, Input, InputNumber, Popconfirm, Space, Table, Tag, Typography } from "antd";
import { saveSelfScores, submitEvaluation, submitSupplement } from "../../services/evaluationService";
import EvidencePanel from "./EvidencePanel";
import { useRecordDrafts } from "../../contexts/WorkspaceContext";

/** Định dạng ISO theo giờ Việt Nam để trình bày, không dùng kết quả để cấp quyền */
export function vietnamTime(value) {
  return value ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Chưa xác định";
}

/** Ánh xạ trạng thái ổn định sang nhãn tiếng Việt cho luồng người dùng */
export const statusLabels = { DRAFT: "Đang tự chấm", PENDING_REVIEW: "Chờ duyệt", SUPPLEMENT_REQUESTED: "Được yêu cầu bổ sung", SUPPLEMENT_SUBMITTED: "Đã nộp bổ sung", SUPPLEMENT_EXPIRED: "Đã hết hạn bổ sung", FINALIZED: "Đã chốt" };

/** Bỏ children rỗng chỉ ở dữ liệu trình bày để Ant Table không vẽ nút mở rộng trên lá
 * Giữ nguyên snapshot API và các field quyền, nhóm có con được chuyển đổi đệ quy theo cùng quy tắc
 */
export function tableRows(criteria) {
  return criteria.map(({ children, ...row }) => children?.length ? { ...row, children: tableRows(children) } : row);
}

/** Hiện một hồ sơ thật, giữ nháp tách snapshot để polling không làm mất nội dung
 * record/summary do server cấp, onReload tải lại quyền/tổng sau ghi, disconnected khóa khi lỗi mạng
 * Lưu thủ công có kết quả từng ô, không cho nộp khi còn nháp hoặc đang lưu
 */
export default function SelfEvaluationCard({ period, record, summary, onReload, disconnected = false }) {
  const [drafts, setDrafts] = useRecordDrafts(`self:${record.id}`);
  const [states, setStates] = useState({});
  const [busy, setBusy] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const busyRef = useRef(false);
  const dirty = Object.keys(drafts).length > 0;
  /** Đối chiếu mọi lá có nháp với quyền mới nhất, không cho nút lưu hàng loạt bỏ qua khóa server */
  const editableIds = (nodes) => nodes.flatMap((row) => row.children?.length ? editableIds(row.children) : row.canEditSelf ? [row.criterionId] : []);
  const allowed = editableIds(record.criteria ?? []);
  const canSaveDrafts = Object.keys(drafts).every((id) => allowed.includes(id));
  // Nhãn chính thức phải đi theo mã xếp loại đã chốt và bộ nhãn của kỳ do server trả
  // Không lấy nhãn tự chấm tạm tính thay kết quả Admin khi hai tổng điểm khác nhau
  const finalRatingLabel = period.ratingThresholds?.find((item) => item.rating === record.finalResult?.rating)?.label || "Chưa có xếp loại";

  /** Hiển thị thời gian còn lại từ snapshot server và thời gian đã trôi đơn điệu
   * Đồng hồ trình duyệt chỉ cập nhật nhãn, không quyết định quyền lưu hoặc nộp
   * Mỗi lần polling nhận serverTime mới thì đặt lại điểm bắt đầu để giảm sai lệch
   */
  useEffect(() => {
    const limit = record.status === "SUPPLEMENT_REQUESTED" ? record.supplementDeadline : record.status === "DRAFT" ? period.selfEvalDeadline : null;
    if (!record.serverTime || !limit) { setRemaining(null); return undefined; }
    const serverTime = Date.parse(record.serverTime);
    const deadline = Date.parse(limit);
    // Snapshot đã quá hạn đã mang quyền khóa từ BE, không hỏi lại vô hạn mỗi lần serverTime thay đổi
    // Chỉ làm mới khi bộ đếm đi qua hạn của snapshot còn hiệu lực lúc nhận để bắt đúng cạnh thời gian
    const wasOpen = deadline > serverTime;
    const started = performance.now();
    let expired = false;
    const update = () => {
      const delay = deadline - serverTime - (performance.now() - started);
      setRemaining(Math.max(0, Math.ceil(delay / 60000)));
      if (delay <= 0 && !expired) { expired = true; if (wasOpen) onReload(); }
    };
    update();
    const timer = setInterval(update, 30000);
    return () => clearInterval(timer);
  }, [record.status, record.serverTime, record.supplementDeadline, period.selfEvalDeadline]);

  /** Giữ cả điểm/diễn giải của lá trong nháp, thay đổi không sửa trực tiếp dữ liệu server
   * Mỗi lần nhập đánh dấu cần lưu và xóa thông báo cũ, 0/null không bị thay bằng giá trị mặc định
   */
  function change(row, field, value) {
    setDrafts((current) => ({ ...current, [row.criterionId]: { selfScore: row.selfScore, selfNote: row.selfNote, ...current[row.criterionId], [field]: value } }));
    setStates((current) => ({ ...current, [row.criterionId]: "Chưa lưu" }));
    setNotice(null);
  }

  /** Lưu một lá hoặc mọi nháp, chỉ xóa ô đã thành công và tải tổng mới từ backend
   * busyRef chặn nhấn lặp trước render, lỗi từng ô giữ nháp để kiểm tra hoặc gửi lại có chủ đích
   * HTTP 200 vẫn phải kiểm results vì một ô lỗi DB không hủy các ô đã lưu
   */
  async function save(criterionId) {
    if (busyRef.current) return;
    const entries = Object.entries(drafts).filter(([id]) => !criterionId || id === criterionId);
    if (!entries.length) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    setStates((current) => ({ ...current, ...Object.fromEntries(entries.map(([id]) => [id, "Đang lưu"])) }));
    try {
      const result = await saveSelfScores(record.id, entries.map(([id, values]) => ({ criterionId: id, ...values })));
      const saved = result.results.filter((item) => item.ok).map((item) => item.criterionId);
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !saved.includes(id))));
      setStates((current) => ({ ...current, ...Object.fromEntries(result.results.map((item) => [item.criterionId, item.ok ? "Đã lưu" : item.error?.message || "Không thể lưu tiêu chí"])) }));
      setNotice(result.results.some((item) => !item.ok) ? { type: "error", text: "Có tiêu chí chưa lưu được, vui lòng kiểm tra thông báo từng ô" } : { type: "success", text: "Đã lưu điểm và diễn giải" });
      await onReload();
    } catch (error) {
      setNotice({ type: "error", text: error.message || "Không thể lưu hồ sơ" });
      setStates((current) => ({ ...current, ...Object.fromEntries(entries.map(([id]) => [id, "Lưu chưa thành công"])) }));
      // Cạnh tranh với deadline hoặc khóa tài khoản cần hỏi lại server, nháp vẫn giữ để người dùng đối chiếu
      await onReload();
    } finally { busyRef.current = false; setBusy(false); }
  }

  /** Nộp sau xác nhận chỉ khi không còn nháp, backend kiểm lại giờ và minh chứng
   * Lỗi hiển thị cả details để không nuốt lý do thiếu điểm/minh chứng, sau lỗi vẫn tải lại quyền
   */
  async function submit() {
    if (busyRef.current || dirty || evidenceBusy) return;
    busyRef.current = true; setBusy(true);
    try {
      if (record.status === "SUPPLEMENT_REQUESTED") await submitSupplement(record.id);
      else await submitEvaluation(record.id);
      setNotice({ type: "success", text: record.status === "SUPPLEMENT_REQUESTED" ? "Đã nộp nội dung bổ sung và khóa chỉnh sửa" : "Đã nộp hồ sơ, nội dung tự chấm đã khóa chỉnh sửa" });
    } catch (error) {
      const details = (error.fieldErrors || []).flatMap((item) => item.messages).join("; ");
      setNotice({ type: "error", text: [error.message || "Không thể nộp hồ sơ", details].filter(Boolean).join(": ") });
    } finally { onReload(); busyRef.current = false; setBusy(false); }
  }

  /** Chỉ lá có input, quyền canEditSelf lấy từ server còn nhóm chỉ tổ chức nội dung
   * Hàng vừa khóa vẫn giữ nháp chưa gửi, TextArea hiển thị văn bản thuần qua React
   */
  const columns = [
    { title: "Mã", dataIndex: "code", width: 100 },
    { title: "Tiêu chí", render: (_, row) => <Space orientation="vertical"><Typography.Text>{row.name}</Typography.Text>{row.evidenceRequirement && <Typography.Text type="secondary">Yêu cầu minh chứng: {row.evidenceRequirement}</Typography.Text>}{row.supplementNote && <Typography.Text>Yêu cầu bổ sung: {row.supplementNote}</Typography.Text>}</Space> },
    { title: "Điểm tối đa", dataIndex: "maxScore", width: 110 },
    { title: "Điểm tự chấm", width: 145, render: (_, row) => row.children?.length ? null : <InputNumber aria-label={`Điểm ${row.code}`} controls={false} min={0} max={row.maxScore} step={0.01} precision={2} value={drafts[row.criterionId]?.selfScore !== undefined ? drafts[row.criterionId].selfScore : row.selfScore} disabled={!row.canEditSelf || busy || disconnected} onChange={(value) => change(row, "selfScore", value)} /> },
    { title: "Diễn giải / minh chứng", width: 360, render: (_, row) => row.children?.length ? null : <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      {row.allowText && <Input.TextArea aria-label={`Diễn giải ${row.code}`} maxLength={5000} showCount autoSize={{ minRows: 3, maxRows: 6 }} value={drafts[row.criterionId]?.selfNote !== undefined ? drafts[row.criterionId].selfNote ?? "" : row.selfNote ?? ""} disabled={!row.canEditSelf || busy || disconnected} onChange={(event) => change(row, "selfNote", event.target.value)} />}
      {row.evidenceRequired && <Typography.Text type="secondary" style={{ display: "block", lineHeight: 1.6 }}>Cần minh chứng thuộc loại được phép{row.allowText ? ", có thể dùng diễn giải" : ""}</Typography.Text>}
      <EvidencePanel evaluationId={record.id} row={row} disabled={busy || disconnected || evidenceBusy} onBusyChange={setEvidenceBusy} onReload={onReload} />
    </Space> },
    { title: "Lưu", width: 190, render: (_, row) => row.children?.length ? null : <Space orientation="vertical" size="middle"><Button onClick={() => save(row.criterionId)} disabled={!drafts[row.criterionId] || !row.canEditSelf || busy || disconnected}>Lưu tiêu chí {row.code}</Button><Typography.Text role="status">{states[row.criterionId] || row.lockedReason || "Đã tải từ máy chủ"}</Typography.Text></Space> },
  ];

  return <Card title={period.name} extra={<Tag>{statusLabels[record.status] || "Trạng thái chưa xác định"}</Tag>}>
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Typography.Text>Mở: {vietnamTime(record.period.selfEvalStart)} · Kết thúc: {vietnamTime(record.period.selfEvalDeadline)} (giờ Việt Nam)</Typography.Text>
      {record.supplementStartAt && <Typography.Text>Lịch bổ sung: {vietnamTime(record.supplementStartAt)} đến trước {vietnamTime(record.supplementDeadline)} (giờ Việt Nam)</Typography.Text>}
      {remaining !== null && <Typography.Text>Thời gian đến hạn {record.status === "SUPPLEMENT_REQUESTED" ? "bổ sung" : "tự chấm"}: khoảng {remaining} phút · Quyền thao tác do máy chủ kiểm tra</Typography.Text>}
      {!record.criteriaVisible ? <Alert type="info" showIcon title="Kỳ đánh giá chưa đến giờ mở tiêu chí" /> : <>
        {record.lockedReason && <Alert type="info" showIcon title={record.lockedReason} />}
        {record.deadlineWarning && <Alert type="warning" showIcon title={record.deadlineWarning} />}
        {summary && <Typography.Text strong>Tổng tự chấm tạm tính: {summary.selfTotal}/{summary.maxTotalScore} · {summary.selfPercent}% · {summary.ratingLabel || "Chưa có xếp loại"} · Đã nhập {summary.scoredCount}/{summary.leafCount} tiêu chí</Typography.Text>}
        {record.finalResult && <Alert type="success" title={`Kết quả đã chốt: ${record.finalResult.score} điểm · ${record.finalResult.percent}% · ${finalRatingLabel}`} />}
        <Table className="self-evaluation-table" rowKey="criterionId" dataSource={tableRows(record.criteria)} columns={columns} pagination={false} defaultExpandAllRows scroll={{ x: 1100 }} />
        <Space wrap><Button type="primary" disabled={!dirty || !canSaveDrafts || busy || disconnected} loading={busy} onClick={() => save()}>Lưu tất cả thay đổi</Button><Popconfirm title={record.status === "SUPPLEMENT_REQUESTED" ? "Nộp nội dung bổ sung?" : "Nộp hồ sơ tự chấm?"} description="Sau khi nộp, đơn vị không thể chỉnh sửa nội dung đã nộp" okText="Nộp hồ sơ" cancelText="Quay lại" onConfirm={submit} disabled={!(record.canSubmit || record.canSubmitSupplement) || dirty || busy || evidenceBusy || disconnected}><Button disabled={!(record.canSubmit || record.canSubmitSupplement) || dirty || busy || evidenceBusy || disconnected}>{record.status === "SUPPLEMENT_REQUESTED" ? "Nộp bổ sung" : "Nộp hồ sơ"}</Button></Popconfirm>{dirty && <Typography.Text type="warning">Có nội dung chưa lưu, cần lưu hết trước khi nộp</Typography.Text>}</Space>
      </>}
      {notice && <Alert type={notice.type} showIcon title={notice.text} />}
      {record.criteriaVisible && <FeedbackPanel key={record.id} evaluationId={record.id} status={record.status} />}
    </Space>
  </Card>;
}
