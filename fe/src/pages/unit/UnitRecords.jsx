import { useEffect, useState } from "react";
import { Alert, Button, Card, ConfigProvider, Empty, Space, Typography } from "antd";
import viVN from "antd/locale/vi_VN";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { createEvaluation, getEvaluation, getScoreSummary, listEvaluations } from "../../services/evaluationService";
import SelfEvaluationCard from "../../components/records/SelfEvaluationCard";

/** Tải kỳ và hồ sơ thật theo phiên UNIT, giữ thẻ ổn định để không mất nháp khi polling
 * Làm mới mỗi 15 giây và tại mốc mở do server trả, timer chỉ hỏi API xác nhận lại quyền
 * Không dùng Date.now để mở tiêu chí, lỗi mạng giữ nội dung local và khóa ghi tới khi tải lại
 */
export default function UnitRecords() {
  const [periods, setPeriods] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    let busy = false;
    let openingTimer;
    /** Lấy metadata trước, sau đó detail và summary chỉ khi server cho xem tiêu chí
     * Hồ sơ chưa có hiện nút tạo bù, polling đọc không tự tạo dữ liệu
     * Lỗi một request giữ snapshot đang chỉnh sửa và không hiển thị thành công giả
     */
    async function load() {
      if (busy) return;
      busy = true;
      try {
        const result = await evaluationPeriodService.getEvaluationPeriods({ pageSize: 100 });
        const rows = await Promise.all((result.items || []).map(async (period) => {
          const records = await listEvaluations({ periodId: period.id, pageSize: 1 });
          if (!records.items.length) return { ...period, record: null, summary: null };
          const record = await getEvaluation(records.items[0].id);
          return { ...period, record, summary: record.criteriaVisible ? await getScoreSummary(record.id) : null };
        }));
        if (active) {
          setPeriods(rows); setError(""); clearTimeout(openingTimer);
          const delays = rows.filter((period) => !period.criteriaVisible && period.selfEvalStart && period.serverTime)
            .map((period) => Date.parse(period.selfEvalStart) - Date.parse(period.serverTime)).filter((delay) => Number.isFinite(delay) && delay > 0);
          if (delays.length) openingTimer = setTimeout(load, Math.min(Math.min(...delays), 2147483647));
        }
      } catch (failure) { if (active) setError(failure.message || "Không thể tải hồ sơ tự chấm"); }
      finally { busy = false; if (active) setLoading(false); }
    }
    void load();
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); clearTimeout(openingTimer); };
  }, [refresh]);

  /** Tạo bù idempotent bằng identity phiên, không gửi unitId hoặc trạng thái từ UNIT
   * Backend kiểm lịch thật, lỗi giữ nguyên danh sách để người dùng tải lại hoặc thử có chủ đích
   */
  async function create(periodId) {
    try { await createEvaluation(periodId); setRefresh((value) => value + 1); }
    catch (failure) { setError(failure.message || "Không thể tạo hồ sơ"); }
  }

  return <ConfigProvider locale={viVN}><Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <Space><Typography.Title level={2}>Hồ sơ tự chấm</Typography.Title><Button loading={loading} onClick={() => setRefresh((value) => value + 1)}>Làm mới</Button></Space>
    {error && <Alert type="error" showIcon title={error} />}
    {!loading && !error && periods.length === 0 && <Empty description="Chưa có kỳ đánh giá được công bố" />}
    {periods.map((period) => period.record ? <SelfEvaluationCard key={period.id} period={period} record={period.record} summary={period.summary} disconnected={Boolean(error)} onReload={() => setRefresh((value) => value + 1)} /> : <Card key={period.id} title={period.name}><Space><Typography.Text>Đơn vị chưa có hồ sơ trong kỳ này</Typography.Text><Button onClick={() => create(period.id)}>Tạo hồ sơ tự chấm</Button></Space></Card>)}
  </Space></ConfigProvider>;
}
