import { useEffect, useRef, useState } from "react";
import { startVisiblePolling } from "../../services/visiblePolling";
import { Alert, Button, Card, ConfigProvider, Empty, Select, Space, Typography } from "antd";
import viVN from "antd/locale/vi_VN";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { createEvaluation, getEvaluation, getScoreSummary, listEvaluations } from "../../services/evaluationService";
import SelfEvaluationCard from "../../components/records/SelfEvaluationCard";
import { allPages } from "../../services/pagination";

/** Tải kỳ và hồ sơ thật theo phiên UNIT, giữ thẻ ổn định để không mất nháp khi polling
 * Làm mới mỗi 15 giây và tại mốc mở do server trả, timer chỉ hỏi API xác nhận lại quyền
 * Không dùng Date.now để mở tiêu chí, lỗi mạng giữ nội dung local và khóa ghi tới khi tải lại
 */
export default function UnitRecords() {
  const [periods, setPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const selectedPeriodIdRef = useRef("");
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    let busy = false;
    let openingTimer;
    /** Lấy danh sách kỳ rồi chỉ tải hồ sơ của kỳ đang chọn
     * Chọn kỳ mới nhất làm mặc định, polling chỉ làm mới hồ sơ đang hiển thị
     * Hồ sơ chưa có hiện nút tạo bù, polling đọc không tự tạo dữ liệu
     * Lỗi một request giữ snapshot đang chỉnh sửa và không hiển thị thành công giả
     */
    async function load() {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const items = await allPages((params) => evaluationPeriodService.getEvaluationPeriods(params));
        const selectedId = items.some((period) => period.id === selectedPeriodIdRef.current)
          ? selectedPeriodIdRef.current
          : [...items].sort((left, right) => right.year - left.year)[0]?.id ?? "";
        const selected = items.find((period) => period.id === selectedId);
        let selectedRow = selected ? { ...selected, record: null, summary: null } : null;
        if (selected) {
          const records = await listEvaluations({ periodId: selected.id, pageSize: 1 });
          if (records.items.length) {
            const record = await getEvaluation(records.items[0].id);
            selectedRow = { ...selected, record, summary: record.criteriaVisible ? record.summary ?? await getScoreSummary(record.id) : null };
          }
        }
        if (active) {
          setPeriods(items); selectedPeriodIdRef.current = selectedId; setSelectedPeriodId(selectedId); setError(""); clearTimeout(openingTimer);
          const delays = selectedRow && !selectedRow.criteriaVisible && selectedRow.selfEvalStart && selectedRow.serverTime
            ? [Date.parse(selectedRow.selfEvalStart) - Date.parse(selectedRow.serverTime)]
            : [];
          const futureDelays = delays.filter((delay) => Number.isFinite(delay) && delay > 0);
          if (futureDelays.length) openingTimer = setTimeout(load, Math.min(Math.min(...futureDelays), 2147483647));
          setCurrentPeriod(selectedRow);
        }
      } catch (failure) { if (active) setError(failure.message || "Không thể tải hồ sơ tự chấm"); return false; }
      finally { busy = false; if (active) setLoading(false); }
    }
    const stop = startVisiblePolling(load, { intervalMs: 30000 });
    return () => { active = false; stop(); clearTimeout(openingTimer); };
  }, [refresh]);

  /** Tạo bù idempotent bằng identity phiên, không gửi unitId hoặc trạng thái từ UNIT
   * Backend kiểm lịch thật, lỗi giữ nguyên danh sách để người dùng tải lại hoặc thử có chủ đích
   */
  async function create(periodId) {
    try { await createEvaluation(periodId); setRefresh((value) => value + 1); }
    catch (failure) { setError(failure.message || "Không thể tạo hồ sơ"); }
  }

  return <ConfigProvider locale={viVN}><Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
      <Typography.Title level={2} style={{ margin: 0 }}>Hồ sơ tự chấm</Typography.Title>
      <Space wrap>
        {periods.length > 0 && <Select
          aria-label="Chọn đợt thi đua"
          value={selectedPeriodId || undefined}
          placeholder="Chọn đợt thi đua"
          style={{ width: 360, maxWidth: "100%" }}
          options={[...periods].sort((left, right) => right.year - left.year).map((period) => ({ value: period.id, label: `${period.name} (${period.year})` }))}
          onChange={(periodId) => { selectedPeriodIdRef.current = periodId; setSelectedPeriodId(periodId); setLoading(true); setRefresh((value) => value + 1); }}
        />}
        <Button aria-label="Làm mới" loading={loading} onClick={() => setRefresh((value) => value + 1)}>Làm mới</Button>
      </Space>
    </Space>
    {error && <Alert type="error" showIcon title={error} />}
    {!loading && !error && periods.length === 0 && <Empty description="Chưa có kỳ đánh giá được công bố" />}
    {currentPeriod?.id === selectedPeriodId && (currentPeriod.record
      ? <SelfEvaluationCard key={currentPeriod.id} period={currentPeriod} record={currentPeriod.record} summary={currentPeriod.summary} disconnected={Boolean(error)} onReload={() => setRefresh((value) => value + 1)} />
      : <Card title={`${currentPeriod.name} (${currentPeriod.year})`}><Space><Typography.Text>Đơn vị chưa có hồ sơ trong kỳ này</Typography.Text><Button onClick={() => create(currentPeriod.id)}>Tạo hồ sơ tự chấm</Button></Space></Card>)}
  </Space></ConfigProvider>;
}
