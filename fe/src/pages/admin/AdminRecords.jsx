import { useEffect, useState } from "react";
import { Alert, Button, Card, ConfigProvider, Empty, Select, Space, Table, Typography } from "antd";
import viVN from "antd/locale/vi_VN";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { getEvaluation, getScoreSummary, listEvaluations } from "../../services/evaluationService";
import { statusLabels, tableRows } from "../../components/records/SelfEvaluationCard";
import EvidencePanel from "../../components/records/EvidencePanel";

/** Tra cứu hồ sơ Admin bằng API thật và phân trang server, chưa mở use-case thẩm định VC12
 * Chọn kỳ rồi xem cây/điểm, lỗi xóa chi tiết cũ để không nhầm hồ sơ đang chọn
 * Quyền và trạng thái hiệu lực do BE quyết định, tổng hiện rõ là tự chấm tạm tính
 */
export default function AdminRecords() {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState({ items: [], total: 0 });
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  /** Đọc kỳ để lập bộ lọc, hủy cập nhật khi rời trang và chỉ hiện lỗi tiếng Việt đã chuẩn hóa */
  useEffect(() => {
    let active = true;
    evaluationPeriodService.getEvaluationPeriods({ pageSize: 100 }).then((result) => { if (active) setPeriods(result.items); }).catch((failure) => { if (active) setError(failure.message || "Không thể tải kỳ đánh giá"); });
    return () => { active = false; };
  }, []);

  /** Tải đúng trang theo kỳ đã chọn, kết quả đến muộn của bộ lọc trước không được ghi đè */
  useEffect(() => {
    let active = true;
    setLoading(true); setDetail(null);
    listEvaluations({ periodId, page, pageSize: 20 }).then((result) => { if (active) { setRows(result); setError(""); } }).catch((failure) => { if (active) { setRows({ items: [], total: 0 }); setError(failure.message || "Không thể tải danh sách hồ sơ"); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [periodId, page, refresh]);

  /** Đọc chi tiết và summary cùng hồ sơ, nút khóa khi đang tải tránh chọn chồng kết quả
   * Không gửi lệnh sửa/chấm Admin vì các nghiệp vụ đó thuộc VC12
   */
  async function inspect(id) {
    setLoading(true); setDetail(null);
    try { const [record, summary] = await Promise.all([getEvaluation(id), getScoreSummary(id)]); setDetail({ record, summary }); setError(""); }
    catch (failure) { setError(failure.message || "Không thể xem hồ sơ"); }
    finally { setLoading(false); }
  }

  return <ConfigProvider locale={viVN}><Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <Typography.Title level={2}>Hồ sơ tự chấm của đơn vị</Typography.Title>
    <Space><Select aria-label="Lọc kỳ đánh giá" allowClear placeholder="Tất cả kỳ" style={{ width: 300 }} value={periodId} options={periods.map((period) => ({ value: period.id, label: period.name }))} onChange={(value) => { setPeriodId(value); setPage(1); }} /><Button loading={loading} onClick={() => setRefresh((value) => value + 1)}>Làm mới</Button></Space>
    {error && <Alert type="error" showIcon title={error} />}
    <Table rowKey="id" loading={loading} dataSource={rows.items} locale={{ emptyText: <Empty description="Chưa có hồ sơ" /> }} pagination={{ current: page, pageSize: 20, total: rows.total, onChange: setPage, showSizeChanger: false }} columns={[
      { title: "Đơn vị", render: (_, row) => row.unit.name }, { title: "Kỳ", render: (_, row) => row.period.name },
      { title: "Trạng thái", render: (_, row) => statusLabels[row.status] || "Chưa xác định" },
      { title: "Chi tiết", render: (_, row) => <Button disabled={loading} onClick={() => inspect(row.id)}>Xem hồ sơ {row.unit.code}</Button> },
    ]} />
    {detail && <Card title={`${detail.record.unit.name} · ${detail.record.period.name}`}><Space orientation="vertical" style={{ width: "100%" }}>
      <Typography.Text>Tổng tự chấm tạm tính: {detail.summary.selfTotal}/{detail.summary.maxTotalScore} · {detail.summary.ratingLabel}</Typography.Text>
      {/* Minh chứng Admin chỉ đọc, dùng URL ký mới mỗi lần xem để không giữ quyền theo đồng hồ FE */}
      <Table rowKey="criterionId" pagination={false} defaultExpandAllRows dataSource={tableRows(detail.record.criteria)} columns={[{ title: "Mã", dataIndex: "code" }, { title: "Tiêu chí", dataIndex: "name" }, { title: "Tối đa", dataIndex: "maxScore" }, { title: "Tự chấm", dataIndex: "selfScore" }, { title: "Diễn giải", dataIndex: "selfNote" }, { title: "Minh chứng", render: (_, row) => row.children?.length ? null : <EvidencePanel evaluationId={detail.record.id} row={{ ...row, canEditSelf: false }} /> }, { title: "Thẩm định", dataIndex: "adminScore" }]} />
    </Space></Card>}
  </Space></ConfigProvider>;
}
