import { useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, DatePicker, Input, InputNumber, Modal, Space, Table, Tag, Typography } from "antd";
import { acceptAllScores, completeFirstReview, requestSupplement, reviewScores } from "../../services/evaluationService";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { statusLabels, tableRows, vietnamTime } from "./SelfEvaluationCard";
import EvidencePanel from "./EvidencePanel";
import { useRecordDrafts } from "../../contexts/WorkspaceContext";

const phaseLabels = { SETUP: "Thiết lập", SELF_EVAL: "Tự chấm", FIRST_REVIEW: "Thẩm định lần đầu", SUPPLEMENT: "Bổ sung", FINAL_REVIEW: "Thẩm định cuối", CLOSED: "Đã đóng" };

/** So sánh song song và thao tác một hồ sơ từ snapshot backend, giữ nháp qua polling
 * Các quyền do server cấp, busyRef ngăn gửi lặp trước render và không dùng giờ máy để mở quyền
 * Parent tải lại sau ghi nhưng không remount cùng hồ sơ nên nháp ô lỗi hoặc chưa lưu vẫn được giữ
 */
export default function ReviewCard({ record, summary, disconnected, onReload, onBusyChange, onFinalize }) {
  const [drafts, setDrafts] = useRecordDrafts(`review:${record.id}`); const [states, setStates] = useState({});
  const [selected, setSelected] = useState([]); const [notes, setNotes] = useState({});
  const [start, setStart] = useState(null); const [end, setEnd] = useState(null); const [schedule, setSchedule] = useState(null);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(null);
  const busyRef = useRef(false);
  const permissions = record.permissions ?? {};
  const dirty = Object.keys(drafts).length > 0;

  /** Chặn thao tác chồng lấn và báo cha khóa chọn hồ sơ trong lúc gửi lệnh */
  function begin() {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); onBusyChange(true); setNotice(null); return true;
  }

  /** Mở khóa sau cả thành công và lỗi, không xóa nháp chưa được backend xác nhận */
  function finish() { busyRef.current = false; setBusy(false); onBusyChange(false); }

  /** Xác nhận trước lệnh thay nhiều điểm hoặc chuyển trạng thái, Ant Modal quản lý focus bàn phím
   * Chỉ gọi action sau xác nhận, backend vẫn kiểm lại quyền và dữ liệu đã đổi trong lúc hộp thoại mở
   */
  function confirm(action, title) {
    Modal.confirm({ title, content: "Máy chủ sẽ kiểm tra lại điều kiện trước khi thực hiện", okText: "Xác nhận", cancelText: "Quay lại", onOk: action });
  }

  /** Khởi tạo nháp đầy đủ từ dữ liệu server, phân biệt null chủ động với giá trị mặc định
   * Điểm chưa duyệt mặc định bằng self, lý do được giữ khi người dùng chỉ đổi điểm
   */
  function change(row, field, value) {
    setDrafts((current) => ({ ...current, [row.criterionId]: { adminScore: row.adminScore ?? row.selfScore, adminComment: row.adminComment ?? "", ...current[row.criterionId], [field]: value } }));
    setStates((current) => ({ ...current, [row.criterionId]: "Chưa lưu" }));
  }

  /** Lưu một ô hoặc toàn bộ nháp qua batch, xóa đúng các ô thành công và giữ lỗi từng mục
   * Ô chưa sửa có thể chấp nhận riêng bằng giá trị mặc định, HTTP 200 vẫn phải đọc từng ok
   */
  async function save(row) {
    const entries = row ? [[row.criterionId, drafts[row.criterionId] ?? { adminScore: row.adminScore ?? row.selfScore, adminComment: row.adminComment ?? "" }]] : Object.entries(drafts);
    if (!entries.length || !begin()) return;
    try {
      const result = await reviewScores(record.id, entries.map(([criterionId, body]) => ({ criterionId, ...body })));
      const saved = result.results.filter((item) => item.ok).map((item) => item.criterionId);
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !saved.includes(id))));
      setStates((current) => ({ ...current, ...Object.fromEntries(result.results.map((item) => [item.criterionId, item.ok ? "Đã lưu" : item.error.message])) }));
      setNotice({ type: result.results.some((item) => !item.ok) ? "error" : "success", text: result.results.some((item) => !item.ok) ? "Có tiêu chí chưa lưu được, vui lòng xem lỗi từng ô" : "Đã lưu thẩm định" });
      await onReload();
    } catch (failure) { setNotice({ type: "error", text: failure.message || "Không thể lưu điểm thẩm định" }); }
    finally { finish(); }
  }

  /** Gọi lệnh nguyên tử rồi tải snapshot mới, lỗi giữ nguyên lựa chọn để người dùng kiểm tra */
  async function execute(action, success) {
    if (!begin()) return;
    try { await action(); await onReload(); setNotice({ type: "success", text: success }); }
    catch (failure) { setNotice({ type: "error", text: failure.message || "Không thể hoàn tất thao tác thẩm định" }); }
    finally { finish(); }
  }

  /** Xem lịch do backend tính từ giờ Việt Nam, đổi ngày chọn sẽ xóa preview cũ
   * Lưu mốc backend đã xác nhận để lệnh yêu cầu không tự tính lại deadline trên FE
   */
  async function previewSchedule() {
    if (!start || !end || !begin()) return;
    try { setSchedule(await evaluationPeriodService.previewSupplementSchedule(`${start.format("YYYY-MM-DDTHH:mm:ss")}+07:00`, `${end.format("YYYY-MM-DDTHH:mm:ss")}+07:00`)); }
    catch (failure) { setNotice({ type: "error", text: failure.message || "Không thể xem lịch bổ sung" }); }
    finally { finish(); }
  }

  /** Tạo một vòng từ các checkbox và ghi chú riêng, chỉ gửi sau khi đã xem lịch backend
   * Không suy ra lựa chọn từ việc gõ ghi chú, mỗi mục chọn bắt buộc có yêu cầu không trắng
   */
  async function supplement() {
    if (!schedule || !selected.length) return;
    const body = { supplementStartAt: schedule.supplementStartAt, supplementDeadline: schedule.supplementDeadline, items: selected.map((criterionId) => ({ criterionId, note: notes[criterionId] ?? "" })) };
    await execute(() => requestSupplement(record.id, body), "Đã gửi yêu cầu bổ sung theo lịch đã chọn");
  }

  const disabled = busy || disconnected;
  // Render chỉ đọc dữ liệu công khai, baseline không chứa key kho tệp và React hiển thị văn bản thuần
  const columns = [
    { title: "Mã", dataIndex: "code", width: 85 },
    { title: "Tiêu chí", render: (_, row) => <Space orientation="vertical"><Typography.Text>{row.name}</Typography.Text>{row.supplementNote && <Typography.Text>Yêu cầu bổ sung: {row.supplementNote}</Typography.Text>}</Space> },
    { title: "Tối đa", dataIndex: "maxScore", width: 85 },
    { title: "Đơn vị tự chấm", width: 220, render: (_, row) => row.children?.length ? null : <Space orientation="vertical"><Typography.Text>Điểm: {row.selfScore ?? "Chưa nhập"}</Typography.Text><Typography.Text>{row.selfNote || "Chưa có diễn giải"}</Typography.Text>{row.supplementBaseline && <Typography.Text type="secondary">Trước bổ sung: {row.supplementBaseline.content.selfScore ?? "Chưa nhập"} điểm · {row.supplementBaseline.content.selfNote || "Chưa có diễn giải"} · {row.supplementChanged ? "Đã thay đổi nội dung" : "Chưa thay đổi nội dung"}</Typography.Text>}</Space> },
    { title: "Minh chứng theo lượt", width: 260, render: (_, row) => row.children?.length ? null : <EvidencePanel evaluationId={record.id} row={{ ...row, canEditSelf: false }} disabled={disabled} /> },
    { title: "Thẩm định", width: 270, render: (_, row) => row.children?.length ? null : <Space orientation="vertical" style={{ width: "100%" }}>
      <InputNumber aria-label={`Điểm thẩm định ${row.code}`} controls={false} min={0} max={row.maxScore} precision={2} value={drafts[row.criterionId] ? drafts[row.criterionId].adminScore : row.adminScore ?? row.selfScore} disabled={disabled || !permissions.canReview} onChange={(value) => change(row, "adminScore", value)} />
      <Input.TextArea aria-label={`Lý do thẩm định ${row.code}`} maxLength={5000} placeholder="Lý do khi khác điểm tự chấm" value={drafts[row.criterionId] ? drafts[row.criterionId].adminComment : row.adminComment ?? ""} disabled={disabled || !permissions.canReview} onChange={(event) => change(row, "adminComment", event.target.value)} />
      <Typography.Text type="secondary">{row.reviewedAt ? `Đã duyệt: ${row.reviewedByName ?? row.reviewedById} · ${vietnamTime(row.reviewedAt)}` : "Chưa thẩm định"}</Typography.Text>
      {row.supplementBaseline?.review && <Typography.Text type="secondary">Điểm duyệt trước bổ sung: {row.supplementBaseline.review.adminScore ?? "Chưa duyệt"} · {row.supplementBaseline.review.adminComment || "Không có lý do"}</Typography.Text>}
      <Button disabled={disabled || !permissions.canReview} onClick={() => save(row)}>Lưu tiêu chí {row.code}</Button><Typography.Text role="status">{states[row.criterionId]}</Typography.Text>
    </Space> },
    { title: "Chọn bổ sung", width: 230, render: (_, row) => row.children?.length ? null : <Space orientation="vertical"><Checkbox aria-label={`Chọn bổ sung ${row.code}`} checked={selected.includes(row.criterionId)} disabled={disabled || !permissions.canRequestSupplement || dirty} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.criterionId] : current.filter((id) => id !== row.criterionId))}>Yêu cầu bổ sung</Checkbox><Input.TextArea aria-label={`Yêu cầu bổ sung ${row.code}`} disabled={disabled || !permissions.canRequestSupplement || !selected.includes(row.criterionId)} maxLength={5000} value={notes[row.criterionId] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [row.criterionId]: event.target.value }))} /></Space> },
  ];

  return <Card title={`${record.unit.name} · ${record.period.name}`} extra={<Tag>{statusLabels[record.status]}</Tag>}>
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text>Tổng tự chấm: {summary.selfTotal}/{summary.maxTotalScore} · {summary.ratingLabel}</Typography.Text>
      <Typography.Text>Lượt đầu: {vietnamTime(record.firstReviewedAt)} · Giai đoạn: {phaseLabels[record.period.phase] ?? "Chưa xác định"}</Typography.Text>
      {record.supplementStartAt && <Alert type="info" showIcon title={`Lịch bổ sung: ${vietnamTime(record.supplementStartAt)} đến trước ${vietnamTime(record.supplementDeadline)} theo giờ Việt Nam`} />}
      {record.finalResult && <Alert type="success" title={`Đã chốt: ${record.finalResult.score} điểm · ${record.finalResult.percent}% · ${record.finalResult.rating}`} />}
      {disconnected && <Alert type="warning" title="Chưa tải lại được quyền từ máy chủ, vui lòng làm mới" />}
      <Table rowKey="criterionId" dataSource={tableRows(record.criteria)} columns={columns} pagination={false} defaultExpandAllRows scroll={{ x: 1500 }} />
      <Space wrap><Button type="primary" loading={busy} disabled={disabled || !dirty || !permissions.canReview} onClick={() => save()}>Lưu tất cả thẩm định</Button><Button disabled={disabled || dirty || !permissions.canReview} onClick={() => confirm(() => execute(() => acceptAllScores(record.id), "Đã chấp nhận các ô chưa duyệt"), "Chấp nhận toàn bộ ô chưa duyệt?")}>Chấp nhận các ô chưa duyệt</Button><Button disabled={disabled || dirty || !permissions.canCompleteFirstReview} onClick={() => confirm(() => execute(() => completeFirstReview(record.id), "Đã hoàn tất thẩm định lần đầu"), "Hoàn tất thẩm định lần đầu?")}>Hoàn tất thẩm định lần đầu</Button><Button disabled={disabled || dirty} onClick={() => onFinalize([record.id])}>Xem trước và chốt hồ sơ</Button></Space>
      {dirty && <Typography.Text type="warning">Có nháp chưa lưu, cần xử lý trước khi hoàn tất lượt đầu, yêu cầu bổ sung hoặc chốt</Typography.Text>}
      <Space wrap><DatePicker aria-label="Ngày giờ mở bổ sung theo giờ Việt Nam" showTime format="DD/MM/YYYY HH:mm" placeholder="Giờ mở theo giờ Việt Nam" value={start} disabled={disabled || !permissions.canRequestSupplement || dirty} onChange={(value) => { setStart(value); setSchedule(null); }} /><DatePicker showTime={{ format: "HH:mm" }} format="DD/MM/YYYY HH:mm" aria-label="Ngày giờ kết thúc bổ sung" placeholder="Giờ kết thúc theo giờ Việt Nam" value={end} disabled={disabled || !permissions.canRequestSupplement || dirty} onChange={(value) => { setEnd(value); setSchedule(null); }} /><Button disabled={disabled || !start || !end || !permissions.canRequestSupplement || dirty} onClick={previewSchedule}>Xem trước lịch bổ sung</Button><Button disabled={disabled || !schedule || !permissions.canRequestSupplement || dirty || !selected.length || selected.some((id) => !notes[id]?.trim())} onClick={() => confirm(supplement, "Gửi yêu cầu bổ sung theo lịch đã xem?")}>Gửi yêu cầu bổ sung</Button></Space>
      {schedule && <Alert type="info" title={`Mở ${vietnamTime(schedule.supplementStartAt)}, ${schedule.displayUntil}`} description={schedule.notice} />}
      {notice && <Alert type={notice.type} showIcon title={notice.text} />}
    </Space>
  </Card>;
}
