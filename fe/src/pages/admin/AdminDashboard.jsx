import { useEffect, useState } from "react";
import { Alert, Button, Card, Col, ConfigProvider, Empty, Progress, Row, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import viVN from "antd/locale/vi_VN";
import { useNavigate } from "react-router-dom";
import { dashboardService } from "../../services/dashboardService";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { statusLabels } from "../../components/records/SelfEvaluationCard";
import styles from "./AdminDashboard.module.css";
import { usePeriodSelection } from "../../services/periodSelection";
import { allPages } from "../../services/pagination";

const formatNumber = (value) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value ?? 0);

/** Đọc dashboard theo kỳ thật và bỏ phản hồi cũ khi người dùng đổi kỳ
 * Dữ liệu đầu vào từ bốn API có cùng periodId, đầu ra là tiến độ, xếp hạng và phổ điểm
 * Backend quyết định trạng thái và điểm; polling chỉ yêu cầu snapshot mới, không suy quyền theo giờ máy
 */
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = usePeriodSelection();
  const [periodError, setPeriodError] = useState("");
  const [periodLoading, setPeriodLoading] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [detailByCriterion, setDetailByCriterion] = useState({});
  const [refresh, setRefresh] = useState(0);

  /** Chọn kỳ mới nhất đã công bố nếu có, kỳ rỗng có trạng thái hiển thị riêng */
  useEffect(() => {
    let active = true;
    allPages((params) => evaluationPeriodService.getEvaluationPeriods(params)).then((items) => {
      if (!active) return;
      setPeriods(items);
      setPeriodId(items.some((item) => item.id === periodId) ? periodId : items.find((item) => item.publishedAt)?.id ?? items[0]?.id);
    }).catch((failure) => { if (active) setPeriodError(failure.message || "Không thể tải danh sách kỳ đánh giá"); })
      .finally(() => { if (active) setPeriodLoading(false); });
    return () => { active = false; };
  }, []);

  /** Tải cùng lúc bốn lát dữ liệu và chỉ công bố snapshot khi mọi API đều thành công */
  useEffect(() => {
    if (!periodId || periodLoading || !periods.some((item) => item.id === periodId)) return undefined;
    let active = true;
    setLoading(true); setError(""); setSnapshot(null);
    Promise.all([
      dashboardService.getDashboardStats(periodId),
      dashboardService.getLeaderboard(periodId, 20),
      dashboardService.getScoreDistribution(periodId),
      dashboardService.getCriteriaDeductions(periodId),
    ]).then(([overview, leaderboard, distribution, deductions]) => {
      if (active) setSnapshot({ overview, leaderboard, distribution, deductions });
    }).catch((failure) => { if (active) setError(failure.message || "Không thể tải dữ liệu tổng quan"); })
      .finally(() => { if (active) setLoading(false); });
    const timer = setInterval(() => setRefresh((value) => value + 1), 30000);
    return () => { active = false; clearInterval(timer); };
  }, [periodId, refresh, periodLoading, periods]);

  const overview = snapshot?.overview;
  const rankingColumns = [
    { title: "Hạng", dataIndex: "rank", width: 80 },
    { title: "Hạng điểm", dataIndex: "scoreRank", width: 100 },
    { title: "Đơn vị", dataIndex: "unitName" },
    { title: "Tự chấm", dataIndex: "selfTotal", render: formatNumber },
    { title: "Điểm hiệu lực", dataIndex: "currentTotal", render: formatNumber },
    { title: "Xếp loại", render: (_, row) => <Space><Tag color={row.ratingColor ?? "default"} style={{ backgroundColor: "#ffffff", color: "#0f172a", borderLeftWidth: 4 }}>{row.ratingLabel ?? "Chưa xếp loại"}</Tag>{!row.isFinal && <Tag>Tạm tính</Tag>}</Space> },
    { title: "Trạng thái", dataIndex: "status", render: (value) => statusLabels[value] ?? "Chưa xác định" },
    { title: "Hồ sơ", render: (_, row) => <Button type="link" onClick={() => navigate(`/admin/records?periodId=${periodId}&evaluationId=${row.evaluationId}`)}>Xem chi tiết</Button> },
  ];

  /** Tải drill-down khi Admin mở tiêu chí, cache theo cả kỳ để không hiển thị hồ sơ kỳ trước */
  async function openDeduction(open, row) {
    if (!open) return;
    const key = `${periodId}:${row.criterionId}`;
    if (detailByCriterion[key]) return;
    setDetailByCriterion((current) => ({ ...current, [key]: { loading: true, items: [] } }));
    try {
      const result = await dashboardService.getDeductionDetail(periodId, row.criterionId);
      setDetailByCriterion((current) => ({ ...current, [key]: { loading: false, items: result.items } }));
    } catch (failure) {
      setDetailByCriterion((current) => ({ ...current, [key]: { loading: false, error: failure.message || "Không thể tải chi tiết điểm trừ", items: [] } }));
    }
  }

  return <ConfigProvider locale={viVN}><div className={styles.dashboardContainer}>
    <Typography.Title level={2}>Tổng quan tiến độ thi đua</Typography.Title>
    <Space wrap style={{ marginBottom: 20 }}><Select aria-label="Chọn kỳ đánh giá" placeholder="Chọn kỳ" style={{ width: 320 }} value={periodId} options={periods.map((period) => ({ value: period.id, label: `${period.name} (${period.year})` }))} onChange={setPeriodId} /><Button disabled={!periodId} onClick={() => setRefresh((value) => value + 1)}>Làm mới</Button></Space>
    {periodError && <Alert type="error" showIcon title={periodError} />}
    {periodLoading && <Card loading title="Đang tải kỳ đánh giá" />}
    {!periodLoading && !periodError && !periods.length && <Empty description="Chưa có kỳ đánh giá" />}
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => setRefresh((value) => value + 1)}>Thử lại</Button>} />}
    {loading && <Card loading title="Đang tải dashboard" />}
    {overview && <>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="Tổng hồ sơ kỳ" value={overview.totalUnits} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="Đã nộp hoặc đã chốt" value={overview.submittedCount} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="Chưa nộp" value={overview.notSubmittedCount} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="Đang chờ bổ sung" value={overview.supplementPendingCount} /></Card></Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}><Card title="Tiến độ"><Progress type="dashboard" percent={overview.progressPercent} /><p>Đã chốt: {overview.finalizedCount} / {overview.totalUnits}</p></Card></Col>
        <Col xs={24} lg={16}><Card title="Nhóm trạng thái"><Space wrap>{Object.entries(overview.statusCounts).map(([status, count]) => <Tag key={status}>{statusLabels[status] ?? status}: {count}</Tag>)}</Space></Card></Col>
      </Row>
      <Card title="Kết quả chính thức từ hồ sơ đã chốt" style={{ marginTop: 16 }}><Space wrap size="large"><Statistic title="Tổng điểm đã chốt" value={overview.officialResults.totalFinalScore} formatter={formatNumber} /><Statistic title="Điểm trung bình" value={overview.officialResults.averageFinalScore} formatter={formatNumber} /><Statistic title="Tỷ lệ trung bình" value={overview.officialResults.averageFinalPercent} suffix="%" formatter={formatNumber} /></Space></Card>
      <Card title="Bảng xếp hạng theo điểm hiệu lực" style={{ marginTop: 16 }}><Typography.Paragraph type="secondary">Kết quả chưa chốt chỉ là tạm tính; đồng hạng điểm có cùng hạng điểm</Typography.Paragraph><Table rowKey="evaluationId" dataSource={snapshot.leaderboard.items} columns={rankingColumns} pagination={false} scroll={{ x: 900 }} locale={{ emptyText: "Chưa có hồ sơ để xếp hạng" }} /></Card>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}><Card title="Phổ điểm hồ sơ đã chốt"><p>Số hồ sơ đã chốt: {snapshot.distribution.finalizedCount}</p>{snapshot.distribution.buckets.map((bucket) => <div key={bucket.key}>{bucket.label}: {bucket.count} <Progress percent={bucket.percent} /></div>)}</Card></Col>
        <Col xs={24} lg={12}><Card title="Xếp loại chính thức">{snapshot.distribution.items.map((item) => <p key={item.rating}><Tag color={item.color ?? "default"}>{item.label}</Tag> {item.count} hồ sơ ({formatNumber(item.percent)}%)</p>)}</Card></Col>
      </Row>
      <Card title="Tiêu chí bị trừ điểm ở hồ sơ đã chốt" style={{ marginTop: 16 }}><Table rowKey="criterionId" dataSource={snapshot.deductions.items} pagination={{ pageSize: 10 }} columns={[{ title: "Mã", dataIndex: "code" }, { title: "Tiêu chí", dataIndex: "name" }, { title: "Số đơn vị", dataIndex: "unitsDeducted" }, { title: "Tổng điểm trừ", dataIndex: "totalPointsDeducted", render: formatNumber }]} expandable={{ onExpand: openDeduction, expandedRowRender: (row) => { const detail = detailByCriterion[`${periodId}:${row.criterionId}`]; return detail?.error ? <Alert type="error" title={detail.error} /> : <Table rowKey="evaluationId" loading={detail?.loading} dataSource={detail?.items ?? []} pagination={false} columns={[{ title: "Đơn vị", dataIndex: "unitName" }, { title: "Tự chấm", dataIndex: "selfScore", render: formatNumber }, { title: "Thẩm định", dataIndex: "adminScore", render: formatNumber }, { title: "Điểm trừ", dataIndex: "pointsDeducted", render: formatNumber }, { title: "Hồ sơ", render: (_, item) => <Button type="link" onClick={() => navigate(`/admin/records?periodId=${periodId}&evaluationId=${item.evaluationId}`)}>Xem hồ sơ</Button> }]} locale={{ emptyText: "Chưa có hồ sơ bị trừ điểm" }} />; } }} locale={{ emptyText: "Chưa có điểm trừ ở hồ sơ đã chốt" }} /></Card>
    </>}
  </div></ConfigProvider>;
}
