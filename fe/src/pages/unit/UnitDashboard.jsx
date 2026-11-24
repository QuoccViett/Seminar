import { useEffect, useState } from "react";
import { Alert, Button, Card, Col, Empty, Progress, Row, Select, Space, Statistic, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { getEvaluation, getScoreSummary, listEvaluations } from "../../services/evaluationService";
import { allPages } from "../../services/pagination";
import EvaluationStatusTag from "../../components/common/EvaluationStatusTag";

const STATUS_LABELS = {
  DRAFT: "Đang tự chấm",
  PENDING_REVIEW: "Chờ thẩm định",
  SUPPLEMENT_REQUESTED: "Được yêu cầu bổ sung",
  SUPPLEMENT_SUBMITTED: "Đã nộp bổ sung",
  SUPPLEMENT_EXPIRED: "Hết hạn bổ sung",
  FINALIZED: "Đã chốt kết quả",
};

function dateTime(value) {
  if (!value) return "Chưa có thông tin";
  return new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

/** Tổng quan cá nhân UNIT, lấy hồ sơ và tổng điểm từ các API đã phân quyền theo phiên */
export default function UnitDashboard() {
  const navigate = useNavigate();
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState("");
  const [periodLoading, setPeriodLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    allPages((params) => evaluationPeriodService.getEvaluationPeriods(params))
      .then((items) => {
        if (!active) return;
        const sorted = [...items].sort((left, right) => right.year - left.year);
        setPeriods(sorted);
        setPeriodId((current) => sorted.some((period) => period.id === current) ? current : sorted[0]?.id ?? "");
      })
      .catch((failure) => { if (active) setError(failure.message || "Không thể tải danh sách đợt thi đua."); })
      .finally(() => { if (active) setPeriodLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!periodId || periodLoading) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    setSnapshot(null);
    async function load() {
      try {
        const [result, thresholds] = await Promise.all([
          listEvaluations({ periodId, page: 1, pageSize: 100 }),
          evaluationPeriodService.getThresholds(periodId),
        ]);
        const metadata = result.items?.[0] ?? null;
        if (!metadata) {
          if (active) setSnapshot({ record: null, summary: null, thresholds });
          return;
        }
        const record = await getEvaluation(metadata.id);
        const summary = record.criteriaVisible ? await getScoreSummary(record.id) : null;
        if (active) setSnapshot({ record, summary, thresholds });
      } catch (failure) {
        if (active) setError(failure.message || "Không thể tải tiến độ tự chấm.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [periodId, periodLoading, refresh]);

  const period = periods.find((item) => item.id === periodId);
  const record = snapshot?.record;
  const summary = snapshot?.summary;
  const finalRatingLabel = snapshot?.thresholds?.find((item) => item.rating === record?.finalResult?.rating)?.label;
  const dueDate = record?.status === "SUPPLEMENT_REQUESTED" ? record.supplementDeadline : record?.period?.selfEvalDeadline ?? period?.selfEvalDeadline;
  const progress = summary?.leafCount ? Math.round((summary.scoredCount / summary.leafCount) * 100) : 0;

  return <Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <div>
      <Typography.Title level={2} style={{ margin: 0 }}>Tổng quan đơn vị</Typography.Title>
      <Typography.Text type="secondary">Theo dõi tiến độ tự chấm của đơn vị theo từng đợt thi đua.</Typography.Text>
    </div>
    <Space wrap>
      <Select aria-label="Chọn đợt thi đua" placeholder="Chọn đợt thi đua" style={{ width: 360, maxWidth: "100%" }} value={periodId || undefined} options={periods.map((item) => ({ value: item.id, label: `${item.name} (${item.year})` }))} onChange={setPeriodId} />
      <Button aria-label="Làm mới" loading={loading || periodLoading} disabled={!periodId} onClick={() => setRefresh((value) => value + 1)}>Làm mới</Button>
      <Button type="primary" onClick={() => navigate("/unit/records")}>Mở hồ sơ tự chấm</Button>
    </Space>
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => setRefresh((value) => value + 1)}>Thử lại</Button>} />}
    {periodLoading && <Card loading title="Đang tải đợt thi đua" />}
    {!periodLoading && !error && periods.length === 0 && <Empty description="Chưa có đợt thi đua được công bố" />}
    {loading && <Card loading title="Đang tải tiến độ" />}
    {!loading && period && snapshot && !record && <Card title={`${period.name} (${period.year})`}>
      <Space orientation="vertical">
        <Typography.Text>Đơn vị chưa có hồ sơ trong đợt này.</Typography.Text>
        <Typography.Text type="secondary">Mở mục Hồ sơ tự chấm để tạo hồ sơ nếu đợt đánh giá đang cho phép.</Typography.Text>
      </Space>
    </Card>}
    {!loading && record && <>
      <Card title={<Space wrap>{record.period.name} ({period?.year})<EvaluationStatusTag status={record.status}>{STATUS_LABELS[record.status] ?? record.status}</EvaluationStatusTag></Space>}>
        <Row gutter={[20, 20]}>
          <Col xs={24} sm={12} lg={8}><Statistic title="Tiến độ đã nhập" value={summary ? `${summary.scoredCount}/${summary.leafCount}` : record.criteriaVisible ? "Chưa có điểm" : "Chưa mở tiêu chí"} /></Col>
          <Col xs={24} sm={12} lg={8}><Statistic title="Tổng điểm tự chấm" value={summary ? summary.selfTotal : "—"} suffix={summary ? `/ ${summary.maxTotalScore}` : undefined} /></Col>
          <Col xs={24} sm={12} lg={8}><Statistic title="Xếp loại hiện tại" value={finalRatingLabel ?? summary?.ratingLabel ?? record.finalResult?.rating ?? "Chưa có"} /></Col>
        </Row>
        {summary && <Progress percent={progress} format={() => `${summary.scoredCount}/${summary.leafCount} tiêu chí`} style={{ marginTop: 20 }} />}
        <Row gutter={[20, 12]} style={{ marginTop: 20 }}>
          <Col xs={24} md={12}><Typography.Text strong>Thời gian mở tự chấm: </Typography.Text>{dateTime(record.period.selfEvalStart)}</Col>
          <Col xs={24} md={12}><Typography.Text strong>Hạn thao tác: </Typography.Text>{dateTime(dueDate)}</Col>
        </Row>
        {record.lockedReason && <Alert style={{ marginTop: 20 }} type="info" showIcon title={record.lockedReason} />}
        {record.deadlineWarning && <Alert style={{ marginTop: 12 }} type="warning" showIcon title={record.deadlineWarning} />}
      </Card>
      <Card title="Việc cần xử lý">
        {record.canSubmit ? <Alert type="warning" showIcon message="Hồ sơ đang mở. Hãy hoàn tất điểm và minh chứng, sau đó nộp hồ sơ." action={<Button type="primary" onClick={() => navigate("/unit/records")}>Tiếp tục tự chấm</Button>} />
          : record.canSubmitSupplement ? <Alert type="warning" showIcon message="Hồ sơ đang trong thời hạn bổ sung. Hãy cập nhật các tiêu chí được yêu cầu rồi nộp bổ sung." action={<Button type="primary" onClick={() => navigate("/unit/records")}>Cập nhật bổ sung</Button>} />
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Hiện không có thao tác nào cần xử lý" />}
      </Card>
      {snapshot.thresholds?.length > 0 && <Card title="Ngưỡng xếp loại của đợt">
        <Space wrap size="large">{snapshot.thresholds.map((item) => <Tag key={item.rating} color={item.color ?? "default"} style={{ border: "1px solid", borderColor: "color-mix(in srgb, currentColor 55%, white)" }}>{item.label}: {item.minExclusive ? "> " : "≥ "}{item.minPercent}%</Tag>)}</Space>
      </Card>}
    </>}
  </Space>;
}
