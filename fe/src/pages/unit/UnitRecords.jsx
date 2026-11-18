import { useEffect, useState } from "react";
import { Alert, Button, Card, ConfigProvider, Empty, Space, Table, Typography } from "antd";
import viVN from "antd/locale/vi_VN";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { criteriaService } from "../../services/criteriaService";

/** Hiển thị thời điểm máy chủ theo giờ Việt Nam mà không dùng giờ máy để cấp quyền
 * value là chuỗi thời gian ISO từ API hoặc rỗng khi kỳ chưa có lịch
 * Kết quả chỉ phục vụ trình bày, mọi quyền xem tiếp tục do backend quyết định
 */
function vietnamTime(value) {
  return value ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Chưa xác định";
}

/** Hiển thị kỳ đã công bố và cây tiêu chí khi API xác nhận đã tới giờ mở
 * Không có đầu vào từ route, dữ liệu được tải theo tài khoản trong phiên hiện tại
 * Làm mới định kỳ và khi người dùng yêu cầu để thấy kỳ mở mà không đăng nhập lại
 * Nếu tải lỗi hoặc component bị hủy, không giữ dữ liệu cũ có thể đã bị thu hồi quyền
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
    /** Lấy metadata trước rồi chỉ xin cây cho kỳ được server cho phép xem
     * Không so sánh thời gian thiết bị, kể cả khi lịch thay đổi giữa hai yêu cầu
     * Nếu một yêu cầu lỗi thì bỏ kết quả cũ và hiển thị thông báo tiếng Việt
     */
    async function load() {
      if (busy) return;
      busy = true;
      try {
        const result = await evaluationPeriodService.getEvaluationPeriods({ pageSize: 100 });
        const rows = await Promise.all((result.items || []).map(async (period) => ({
          ...period,
          tree: period.criteriaVisible ? await criteriaService.getCriteria(period.id) : [],
        })));
        if (active) {
          setPeriods(rows);
          setError("");
          clearTimeout(openingTimer);
          // Chỉ lên lịch hỏi lại API theo chênh lệch hai mốc server, không tự mở quyền trên FE
          const delays = rows.filter((period) => !period.criteriaVisible && period.selfEvalStart && period.serverTime)
            .map((period) => Date.parse(period.selfEvalStart) - Date.parse(period.serverTime))
            .filter((delay) => Number.isFinite(delay) && delay > 0);
          if (delays.length) openingTimer = setTimeout(load, Math.min(Math.min(...delays), 2147483647));
        }
      } catch (failure) {
        if (active) { setPeriods([]); setError(failure.message || "Không thể tải kỳ đánh giá"); }
      } finally {
        busy = false;
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); clearTimeout(openingTimer); };
  }, [refresh]);

  return <ConfigProvider locale={viVN}><Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <Space><Typography.Title level={2}>Kỳ đánh giá</Typography.Title><Button loading={loading} onClick={() => setRefresh((value) => value + 1)}>Làm mới</Button></Space>
    {error && <Alert type="error" showIcon title={error} />}
    {!loading && !error && periods.length === 0 && <Empty description="Chưa có kỳ đánh giá được công bố" />}
    {periods.map((period) => <Card key={period.id} title={period.name}>
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Typography.Text>Mở: {vietnamTime(period.selfEvalStart)} · Kết thúc: {vietnamTime(period.selfEvalDeadline)} (giờ Việt Nam)</Typography.Text>
        {!period.criteriaVisible ? <Alert type="info" showIcon title="Kỳ đánh giá chưa đến giờ mở tiêu chí" /> : <>
          <Typography.Text>{period.selfEvalState === "CLOSED" ? "Đã hết thời gian tự chấm" : "Đang trong thời gian tự chấm"}</Typography.Text>
          <Table rowKey="id" dataSource={period.tree} pagination={false} columns={[
            { title: "Mã", dataIndex: "code" },
            { title: "Tiêu chí", dataIndex: "name" },
            { title: "Điểm tối đa", dataIndex: "maxScore" },
          ]} />
        </>}
      </Space>
    </Card>)}
  </Space></ConfigProvider>;
}
