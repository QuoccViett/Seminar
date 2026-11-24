import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, ConfigProvider, Empty, Modal, Popconfirm, Select, Space, Table, Typography } from "antd";
import viVN from "antd/locale/vi_VN";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { finalizeEvaluations, getReview, getScoreSummary, listEvaluations, previewFinalize } from "../../services/evaluationService";
import { statusLabels } from "../../components/records/SelfEvaluationCard";
import ReviewCard from "../../components/records/ReviewCard";
import FeedbackPanel from "../../components/records/FeedbackPanel";
import { usePeriodSelection } from "../../services/periodSelection";
import { allPages } from "../../services/pagination";
import EvaluationStatusTag from "../../components/common/EvaluationStatusTag";

const phaseLabels = { SETUP: "Thiết lập", SELF_EVAL: "Tự chấm", FIRST_REVIEW: "Thẩm định lần đầu", SUPPLEMENT: "Bổ sung", FINAL_REVIEW: "Thẩm định cuối", CLOSED: "Đã đóng" };

/** Quản lý danh sách, thẩm định và chốt hàng loạt bằng backend thật
 * Danh sách phân trang server, quyền phase và preview đều do server tính
 * Kết quả request tới muộn bị bỏ qua khi đổi hồ sơ, polling không remount nháp của cùng hồ sơ
 */
export default function AdminRecords() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [periods, setPeriods] = useState([]); const [periodId, setPeriodId] = usePeriodSelection();
  const [page, setPage] = useState(1); const [rows, setRows] = useState({ items: [], total: 0 });
  const [detail, setDetail] = useState(null); const [detailError, setDetailError] = useState(false);
  const [error, setError] = useState(""); const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false); const [recordBusy, setRecordBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState([]); const [phaseOptions, setPhaseOptions] = useState(null);
  const [phaseTarget, setPhaseTarget] = useState(); const [finalize, setFinalize] = useState(null);
  const activeId = useRef(null); const sending = useRef(false);
  const busy = recordBusy || actionBusy || detailLoading;

  /** Mở hồ sơ từ URL cả khi quay lại lịch sử trình duyệt, bỏ lệnh trùng hồ sơ đang chọn
   * API vẫn kiểm quyền và kỳ thực, query không được dùng làm dữ liệu hoặc identity
   */
  useEffect(() => {
    const linkedPeriodId = searchParams.get("periodId");
    const linkedEvaluationId = searchParams.get("evaluationId");
    if (!linkedPeriodId || !linkedEvaluationId || activeId.current === linkedEvaluationId) return;
    setPeriodId(linkedPeriodId);
    void inspect(linkedEvaluationId);
  }, [searchParams]);

  /** Tải bộ lọc kỳ một lần, bỏ kết quả đến sau khi trang đã đóng */
  useEffect(() => {
    let active = true;
    allPages((params) => evaluationPeriodService.getEvaluationPeriods(params)).then((items) => { if (active) setPeriods(items); }).catch((failure) => { if (active) setError(failure.message || "Không thể tải kỳ đánh giá"); });
    return () => { active = false; };
  }, []);

  /** Đọc đúng trang và kỳ hiện tại, làm mới không xóa hồ sơ và nháp đang thẩm định */
  useEffect(() => {
    let active = true; setListLoading(true);
    listEvaluations({ periodId, page, pageSize: 20 }).then((result) => { if (active) setRows(result); }).catch((failure) => { if (active) { setRows({ items: [], total: 0 }); setError(failure.message || "Không thể tải danh sách hồ sơ"); } }).finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [periodId, page, refresh]);

  /** Đọc cạnh phase từ backend khi chọn kỳ hoặc sau thao tác làm thay đổi hồ sơ
   * Không dựng quyền chuyển phase bằng đồng hồ hoặc số hồ sơ do FE tính
   */
  useEffect(() => {
    let active = true; setPhaseTarget(undefined);
    if (!periodId) { setPhaseOptions(null); return undefined; }
    evaluationPeriodService.getPhaseOptions(periodId).then((result) => { if (active) setPhaseOptions(result); }).catch((failure) => { if (active) { setPhaseOptions(null); setError(failure.message || "Không thể tải quyền chuyển giai đoạn"); } });
    return () => { active = false; };
  }, [periodId, refresh]);

  /** Tải lại cùng hồ sơ và tổng, giữ nháp ở ReviewCard qua khóa React không đổi
   * Danh tính request phải còn trùng hồ sơ đang chọn để phản hồi chậm không ghi đè màn khác
   */
  const reloadDetail = useCallback(async (id) => {
    try {
      const [record, summary] = await Promise.all([getReview(id), getScoreSummary(id)]);
      if (activeId.current === id) { setDetail({ record, summary }); setDetailError(false); }
      return record;
    } catch (failure) {
      if (activeId.current === id) { setDetailError(true); setError(failure.message || "Không thể tải chi tiết hồ sơ"); }
      throw failure;
    }
  }, []);

  const detailId = detail?.record.id;
  /** Đồng bộ quyền và trạng thái mỗi 15 giây, lỗi polling khóa thao tác nhưng giữ nháp */
  useEffect(() => {
    if (!detailId) return undefined;
    const timer = setInterval(() => { if (!sending.current) void reloadDetail(detailId).catch(() => {}); }, 15000);
    const onVisible = () => { if (document.visibilityState === "visible" && !sending.current) { void reloadDetail(detailId).catch(() => {}); setRefresh((value) => value + 1); } };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [detailId, reloadDetail]);

  /** Chọn hồ sơ mới có chủ đích, xóa chi tiết cũ để không nhầm dữ liệu khi đang tải */
  async function inspect(id) {
    activeId.current = id; setDetail(null); setDetailError(false); setDetailLoading(true); setError("");
    try {
      const record = await reloadDetail(id);
      if (activeId.current === id) {
        setPeriodId(record.period.id);
        setSearchParams({ periodId: record.period.id, evaluationId: id }, { replace: true });
      }
    } catch { /* Lỗi công khai đã được reloadDetail hiển thị */ }
    finally { setDetailLoading(false); }
  }

  /** Tải lại sau lệnh ghi và yêu cầu cập nhật danh sách cùng quyền chuyển phase */
  async function afterWrite() {
    if (activeId.current) await reloadDetail(activeId.current);
    setRefresh((value) => value + 1);
  }

  /** Xem trước các hồ sơ đã chọn, một mục lỗi không ngăn người dùng xem các mục còn lại */
  async function openFinalize(ids) {
    if (sending.current || !ids.length) return;
    sending.current = true; setActionBusy(true); setError("");
    try { const result = await previewFinalize(ids); setFinalize({ ids, results: result.results, done: false }); }
    catch (failure) { setError(failure.message || "Không thể xem trước kết quả chốt"); }
    finally { sending.current = false; setActionBusy(false); }
  }

  /** Xác nhận chốt đúng danh sách đã preview, giữ kết quả riêng của cả mục thành công và thất bại
   * Backend kiểm lại từng hồ sơ sau khóa, giao diện không coi preview cũ là quyền ghi
   * Chỉ giữ tên đơn vị để định danh dòng, nhãn xếp loại phải lấy từ kết quả chốt thực tế
   */
  async function confirmFinalize() {
    if (sending.current || !finalize) return;
    sending.current = true; setActionBusy(true);
    try {
      const result = await finalizeEvaluations(finalize.ids);
      setFinalize((current) => ({ ...current, results: result.results.map((item) => ({ ...item, unitName: current.results.find((preview) => preview.evaluationId === item.evaluationId)?.data?.unitName })), done: true }));
      await afterWrite();
    } catch (failure) { setError(failure.message || "Không thể chốt các hồ sơ đã chọn"); }
    finally { sending.current = false; setActionBusy(false); }
  }

  /** Gửi cạnh phase đã chọn và tải lại snapshot, mọi điều kiện do backend kiểm trong transaction */
  async function transition() {
    if (sending.current || !periodId || !phaseTarget) return;
    sending.current = true; setActionBusy(true);
    try { await evaluationPeriodService.transitionPhase(periodId, phaseTarget); await afterWrite(); setError(""); }
    catch (failure) { setError(failure.message || "Không thể chuyển giai đoạn kỳ"); }
    finally { sending.current = false; setActionBusy(false); }
  }

  return <ConfigProvider locale={viVN}><Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <Typography.Title level={2}>Thẩm định hồ sơ đơn vị</Typography.Title>
    <Space wrap><Select aria-label="Lọc kỳ đánh giá" allowClear disabled={busy} placeholder="Tất cả kỳ" style={{ width: 300 }} value={periodId} options={periods.map((period) => ({ value: period.id, label: period.name }))} onChange={(value) => { setPeriodId(value); setPage(1); setSelected([]); activeId.current = null; setDetail(null); }} /><Button aria-label="Làm mới" loading={listLoading} disabled={busy} onClick={() => { setRefresh((value) => value + 1); if (activeId.current) void reloadDetail(activeId.current).catch(() => {}); }}>Làm mới</Button><Button disabled={busy || !selected.length} onClick={() => openFinalize(selected)}>Xem trước và chốt đã chọn ({selected.length})</Button></Space>
    {phaseOptions && <Space wrap><Typography.Text>Giai đoạn: {phaseLabels[phaseOptions.phase] || phaseOptions.phase}</Typography.Text><Select aria-label="Giai đoạn muốn chuyển" placeholder="Chọn giai đoạn" disabled={busy} style={{ width: 280 }} value={phaseTarget} options={phaseOptions.options.map((item) => ({ value: item.phase, label: phaseLabels[item.phase], disabled: !item.allowed, title: item.message }))} onChange={setPhaseTarget} /><Popconfirm title="Chuyển giai đoạn kỳ?" description="Máy chủ sẽ kiểm lại trạng thái toàn bộ hồ sơ" okText="Chuyển giai đoạn" cancelText="Quay lại" onConfirm={transition}><Button disabled={busy || !phaseTarget}>Chuyển giai đoạn</Button></Popconfirm></Space>}
    {error && <Alert type="error" showIcon title={error} />}
    <Table rowKey="id" loading={listLoading} dataSource={rows.items} rowSelection={{ selectedRowKeys: selected, preserveSelectedRowKeys: true, onChange: setSelected, getCheckboxProps: () => ({ disabled: busy }) }} locale={{ emptyText: <Empty description="Chưa có hồ sơ" /> }} pagination={{ current: page, pageSize: 20, total: rows.total, onChange: setPage, showSizeChanger: false, disabled: busy }} columns={[
      { title: "Đơn vị", render: (_, row) => row.unit.name }, { title: "Kỳ", render: (_, row) => row.period.name },
      { title: "Trạng thái", render: (_, row) => <EvaluationStatusTag status={row.status}>{statusLabels[row.status] || "Chưa xác định"}</EvaluationStatusTag> },
      { title: "Chi tiết", render: (_, row) => <Button disabled={busy} onClick={() => inspect(row.id)}>Thẩm định {row.unit.code}</Button> },
    ]} />
    {detail && <ReviewCard key={detail.record.id} record={detail.record} summary={detail.summary} disconnected={detailError || actionBusy} onReload={afterWrite} onBusyChange={(value) => { sending.current = value; setRecordBusy(value); }} onFinalize={openFinalize} />}
    {detail && <FeedbackPanel key={`feedback-${detail.record.id}`} evaluationId={detail.record.id} status={detail.record.status} />}
    <Modal title={finalize?.done ? "Kết quả chốt từng hồ sơ" : "Xem trước kết quả chốt"} open={Boolean(finalize)} width={900} onCancel={() => { if (!actionBusy) setFinalize(null); }} footer={<Space><Button disabled={actionBusy} onClick={() => setFinalize(null)}>{finalize?.done ? "Đóng" : "Quay lại"}</Button>{!finalize?.done && <Button danger type="primary" loading={actionBusy} disabled={!finalize?.results.some((item) => item.ok && item.data.canFinalize)} onClick={confirmFinalize}>Xác nhận chốt ({finalize?.ids.length})</Button>}</Space>}>
      <Typography.Paragraph>Mỗi hồ sơ có kết quả riêng; máy chủ kiểm lại điều kiện tại lúc chốt</Typography.Paragraph>
      <Table rowKey="evaluationId" pagination={false} dataSource={finalize?.results ?? []} columns={[
        { title: "Đơn vị", render: (_, row) => row.data?.unitName ?? row.unitName ?? "Hồ sơ không có thông tin đơn vị" }, { title: "Điểm", render: (_, row) => row.ok ? row.data.score ?? row.data.finalScore : "—" },
        { title: "Xếp loại", render: (_, row) => row.ok ? row.data.finalRatingLabel ?? row.data.ratingLabel ?? "Chưa có xếp loại" : "—" },
        { title: "Kết quả", render: (_, row) => row.ok ? finalize.done ? "Đã chốt thành công" : row.data.message : row.error.message },
      ]} />
    </Modal>
  </Space></ConfigProvider>;
}
