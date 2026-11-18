import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, Card, ConfigProvider, Empty, Select, Space, Table, Tag, Typography } from "antd";
import viVN from "antd/locale/vi_VN";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { listEvaluations } from "../../services/evaluationService";
import { createReport, downloadReport, listReports } from "../../services/reportService";
import { statusLabels } from "../../components/records/SelfEvaluationCard";

const typeOptions = [{ value: "SUMMARY_ALL_UNITS", label: "Tổng hợp đơn vị (Excel)" }, { value: "UNIT_APPRAISAL_MINUTES", label: "Biên bản thẩm định (PDF/Word)" }];
const typeLabels = Object.fromEntries(typeOptions.map((item) => [item.value, item.label]));

/** Chỉ giữ câu tiếng Việt đã chuẩn hóa, lỗi URL hoặc trình duyệt lạ dùng thông báo theo thao tác
 * Không phản chiếu ngoại lệ tiếng Anh hoặc thông tin kỹ thuật từ thư viện ra giao diện
 */
function reportError(failure, fallback) { return typeof failure?.message === "string" && /[À-ỹ]/u.test(failure.message) ? failure.message : fallback; }

/** Tải đủ các trang lựa chọn từ API, không cắt mất kỳ hoặc hồ sơ ngoài 100 mục đầu tiên
 * Mỗi trang vẫn theo giới hạn backend, caller bỏ kết quả khi đã đổi kỳ hoặc rời trang
 */
async function choices(loader, params = {}) {
  const items = [];
  for (let page = 1; ; page++) {
    const result = await loader({ ...params, page, pageSize: 100 });
    items.push(...result.items);
    if (items.length >= result.total || !result.items.length) return items;
  }
}

/** Màn hình báo cáo ADMIN dùng backend thật, tạo đồng bộ và tải tệp private có chữ ký
 * Kỳ/hồ sơ từ URL chỉ là lựa chọn giao diện, server luôn kiểm lại quyền và scope
 * Phân biệt tải dữ liệu, rỗng, đang tạo và lỗi để không báo thành công từ dữ liệu cũ
 */
export default function AdminReports() {
  const [search] = useSearchParams();
  const initial = useRef({ periodId: search.get("periodId"), evaluationId: search.get("evaluationId") });
  const [periods, setPeriods] = useState([]); const [periodId, setPeriodId] = useState();
  const [periodLoading, setPeriodLoading] = useState(true); const [periodError, setPeriodError] = useState(""); const [periodRetry, setPeriodRetry] = useState(0);
  const [reportType, setReportType] = useState(initial.current.evaluationId ? "UNIT_APPRAISAL_MINUTES" : "SUMMARY_ALL_UNITS"); const [format, setFormat] = useState("PDF");
  const [evaluations, setEvaluations] = useState([]); const [evaluationId, setEvaluationId] = useState(); const [evaluationLoading, setEvaluationLoading] = useState(false); const [evaluationError, setEvaluationError] = useState(""); const [evaluationRetry, setEvaluationRetry] = useState(0);
  const [filterType, setFilterType] = useState(); const [filterFormat, setFilterFormat] = useState();
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20); const [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState({ items: [], total: 0 }); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [creating, setCreating] = useState(false); const [downloading, setDownloading] = useState(); const [notice, setNotice] = useState(""); const [operationError, setOperationError] = useState("");
  const createLock = useRef(false); const downloadLock = useRef(false);

  /** Nạp danh sách kỳ và ưu tiên UUID trên URL nếu tồn tại, nếu không dùng kỳ mới nhất */
  useEffect(() => {
    let active = true; setPeriodLoading(true); setPeriodError("");
    choices((params) => evaluationPeriodService.getEvaluationPeriods(params)).then((items) => {
      if (!active) return; setPeriods(items);
      setPeriodId(items.some((item) => item.id === initial.current.periodId) ? initial.current.periodId : items[0]?.id);
    }).catch((failure) => { if (active) setPeriodError(reportError(failure, "Không thể tải danh sách kỳ")); })
      .finally(() => { if (active) setPeriodLoading(false); });
    return () => { active = false; };
  }, [periodRetry]);

  /** Chỉ tải hồ sơ của kỳ đang chọn cho biên bản, bỏ phản hồi muộn của kỳ trước
   * Chưa có hồ sơ phải hiện trạng thái rỗng, lỗi có nút thử lại và không dùng dữ liệu kỳ cũ
   */
  useEffect(() => {
    setEvaluations([]); setEvaluationId(undefined); setEvaluationError("");
    if (!periodId || reportType !== "UNIT_APPRAISAL_MINUTES") return undefined;
    let active = true; setEvaluationLoading(true);
    choices(listEvaluations, { periodId }).then((items) => {
      if (!active) return; setEvaluations(items);
      setEvaluationId(items.some((item) => item.id === initial.current.evaluationId) ? initial.current.evaluationId : items[0]?.id);
    }).catch((failure) => { if (active) setEvaluationError(reportError(failure, "Không thể tải danh sách hồ sơ")); })
      .finally(() => { if (active) setEvaluationLoading(false); });
    return () => { active = false; };
  }, [periodId, reportType, evaluationRetry]);

  /** Tải lịch sử theo bộ lọc và trang, luôn xóa kết quả cũ khi lỗi để tránh nhầm trạng thái */
  useEffect(() => {
    if (!periodId) return undefined;
    let active = true; setLoading(true); setError(""); setRows({ items: [], total: 0 });
    listReports({ periodId, reportType: filterType, format: filterFormat, page, pageSize }).then((result) => { if (active) setRows(result); })
      .catch((failure) => { if (active) { setRows({ items: [], total: 0 }); setError(reportError(failure, "Không thể tải lịch sử báo cáo")); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [periodId, filterType, filterFormat, page, pageSize, refresh]);

  /** Chặn nhấp lặp trong cùng nhịp render, gửi đúng scope rồi làm mới lịch sử khi POST thành công
   * Định dạng Excel được cố định cho tổng hợp, biên bản luôn gửi UUID hồ sơ đã chọn
   */
  async function create() {
    if (createLock.current) return;
    createLock.current = true; setCreating(true); setOperationError(""); setNotice("");
    try {
      const result = await createReport({ periodId, reportType, format: reportType === "SUMMARY_ALL_UNITS" ? "XLSX" : format, ...(reportType === "UNIT_APPRAISAL_MINUTES" ? { evaluationId } : {}) });
      setNotice(`Đã tạo báo cáo ${result.fileName}`); setPage(1); setRefresh((value) => value + 1);
    } catch (failure) { setOperationError(reportError(failure, "Không thể tạo báo cáo, vui lòng thử lại")); }
    finally { createLock.current = false; setCreating(false); }
  }

  /** Xin liên kết mới qua service và lưu bytes thật, thu hồi URL sau khi trình duyệt nhận lệnh tải
   * Lỗi tải không làm mất lịch sử đã lưu, người dùng có thể thử lại để xin chữ ký mới
   */
  async function download(id) {
    if (downloadLock.current) return;
    downloadLock.current = true; setDownloading(id); setOperationError("");
    try {
      const file = await downloadReport(id); const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a"); link.href = url; link.download = file.fileName; document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (failure) { setOperationError(reportError(failure, "Không thể tải báo cáo, vui lòng thử lại")); }
    finally { downloadLock.current = false; setDownloading(undefined); }
  }

  return <ConfigProvider locale={viVN}><Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <Typography.Title level={2}>Báo cáo Excel, PDF và Word</Typography.Title>
    {periodError && <Alert type="error" title={periodError} action={<Button onClick={() => setPeriodRetry((value) => value + 1)}>Thử tải lại kỳ</Button>} />}
    {!periodLoading && !periodError && !periods.length && <Empty description="Chưa có kỳ đánh giá" />}
    <Card title="Tạo báo cáo">
      <Space wrap>
        <label htmlFor="report-period">Kỳ đánh giá</label><Select id="report-period" aria-label="Kỳ đánh giá" style={{ minWidth: 260 }} value={periodId} loading={periodLoading} disabled={creating || periodLoading} options={periods.map((item) => ({ value: item.id, label: `${item.name} (${item.year})` }))} onChange={(id) => { setPeriodId(id); setPage(1); setNotice(""); setOperationError(""); }} />
        <label htmlFor="report-type">Loại báo cáo</label><Select id="report-type" aria-label="Loại báo cáo" style={{ minWidth: 270 }} value={reportType} disabled={creating} options={typeOptions} onChange={setReportType} />
        <label htmlFor="report-format">Định dạng</label><Select id="report-format" aria-label="Định dạng" style={{ width: 130 }} value={reportType === "SUMMARY_ALL_UNITS" ? "XLSX" : format} disabled={creating} options={(reportType === "SUMMARY_ALL_UNITS" ? ["XLSX"] : ["PDF", "DOCX"]).map((value) => ({ value, label: value === "DOCX" ? "Word" : value }))} onChange={setFormat} />
      </Space>
      {reportType === "UNIT_APPRAISAL_MINUTES" && <Space wrap style={{ marginTop: 16 }}><label htmlFor="report-evaluation">Hồ sơ đơn vị</label><Select id="report-evaluation" aria-label="Hồ sơ đơn vị" style={{ minWidth: 360 }} value={evaluationId} loading={evaluationLoading} disabled={creating || evaluationLoading} options={evaluations.map((item) => ({ value: item.id, label: `${item.unit.name} — ${statusLabels[item.status] ?? "Chưa xác định"}` }))} onChange={setEvaluationId} />{!evaluationLoading && !evaluationError && !evaluations.length && <Typography.Text>Chưa có hồ sơ trong kỳ này</Typography.Text>}</Space>}
      {evaluationError && <Alert type="error" title={evaluationError} action={<Button onClick={() => setEvaluationRetry((value) => value + 1)}>Thử tải lại hồ sơ</Button>} />}
      <Typography.Paragraph style={{ marginTop: 16 }}>Hồ sơ chưa chốt được ghi CHƯA CHỐT — TẠM TÍNH trong tệp. Biên bản có phần ký trống và dùng bố cục làm việc phục vụ đồ án.</Typography.Paragraph>
      <Button type="primary" onClick={create} loading={creating} disabled={!periodId || Boolean(periodError) || (reportType === "UNIT_APPRAISAL_MINUTES" && (!evaluationId || evaluationLoading || Boolean(evaluationError)))}>Tạo báo cáo</Button>
      {creating && <Alert type="info" title="Đang tạo và lưu tệp báo cáo, vui lòng chờ" />}
    </Card>
    {notice && <Alert type="success" title={notice} showIcon />}{operationError && <Alert type="error" title={operationError} showIcon />}
    <Card title="Lịch sử báo cáo">
      <Space wrap style={{ marginBottom: 16 }}>
        <Select aria-label="Lọc loại báo cáo" placeholder="Tất cả loại báo cáo" allowClear style={{ minWidth: 260 }} value={filterType} options={typeOptions} onChange={(value) => { setFilterType(value); setPage(1); }} />
        <Select aria-label="Lọc định dạng" placeholder="Tất cả định dạng" allowClear style={{ minWidth: 170 }} value={filterFormat} options={["XLSX", "PDF", "DOCX"].map((value) => ({ value, label: value }))} onChange={(value) => { setFilterFormat(value); setPage(1); }} />
        <Button onClick={() => setRefresh((value) => value + 1)} loading={loading}>Tải lại lịch sử</Button>
      </Space>
      {error && <Alert type="error" title={error} showIcon />}
      <Table rowKey="id" loading={loading} dataSource={rows.items} scroll={{ x: 950 }} locale={{ emptyText: <Empty description="Chưa có báo cáo phù hợp" /> }} pagination={{ current: page, pageSize, total: rows.total, showSizeChanger: true, onChange: (next, size) => { setPage(next); setPageSize(size); } }} columns={[
        { title: "Tệp", dataIndex: "fileName" }, { title: "Loại", dataIndex: "reportType", render: (value) => typeLabels[value] ?? "Chưa xác định" }, { title: "Định dạng", dataIndex: "format" },
        { title: "Trạng thái", dataIndex: "status", render: (value) => <Tag color={value === "READY" ? "green" : "default"}>{value === "READY" ? "Sẵn sàng" : "Chưa sẵn sàng"}</Tag> },
        { title: "Dung lượng", dataIndex: "sizeBytes", render: (value) => value == null ? "Chưa có" : `${new Intl.NumberFormat("vi-VN").format(value)} byte` },
        { title: "Tạo lúc (Việt Nam)", dataIndex: "createdAt", render: (value) => new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) },
        { title: "Tải tệp", render: (_, row) => <Button disabled={Boolean(downloading) || row.status !== "READY"} loading={downloading === row.id} onClick={() => download(row.id)}>Tải {row.format}</Button> },
      ]} />
    </Card>
  </Space></ConfigProvider>;
}
