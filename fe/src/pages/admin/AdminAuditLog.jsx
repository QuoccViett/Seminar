import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, ConfigProvider, Descriptions, Empty, Form, Input, Modal, Space, Table, Typography } from "antd";
import viVN from "antd/locale/vi_VN";
import { auditLogService } from "../../services/auditLogService";

/** Đổi bộ lọc giờ Việt Nam sang ISO có offset để server kiểm khoảng thời gian rõ ràng
 * Input datetime-local không có timezone nên gắn +07:00, không phụ thuộc múi giờ máy
 */
function filters(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value?.trim()).map(([key, value]) => [key, ["from", "to"].includes(key) ? `${value}:00+07:00` : value.trim()]));
}

/** Truy vấn audit thật theo trang, lọc người/đối tượng/hành động/thời gian và xem snapshot
 * Bỏ chart không có API, hiển thị lỗi/empty rõ và hủy kết quả tải muộn khi đổi bộ lọc
 */
export default function AdminAuditLog() {
  const [query, setQuery] = useState({}); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState({ items: [], total: 0 }); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(""); const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState(null); const [detailError, setDetailError] = useState(""); const [detailLoading, setDetailLoading] = useState(false);
  const detailRequest = useRef(0);

  /** Tải cùng bộ lọc phân trang, lỗi xóa kết quả cũ để không nhầm đó là dữ liệu mới */
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    auditLogService.getAuditLogs({ ...query, page, pageSize }).then((result) => { if (active) setRows(result); })
      .catch((failure) => { if (active) { setRows({ items: [], total: 0 }); setError(failure.message || "Không thể tải nhật ký hoạt động"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, page, pageSize, refresh]);

  /** Đọc chi tiết riêng theo ID, bỏ response của lần mở trước để không hiện nhầm snapshot
   * Modal mở cả khi lỗi để người dùng thấy nguyên nhân và có thể thử lại
   */
  async function inspect(id) {
    const request = ++detailRequest.current; setDetail({ id }); setDetailError(""); setDetailLoading(true);
    try { const result = await auditLogService.getAuditLog(id); if (request === detailRequest.current) setDetail(result); }
    catch (failure) { if (request === detailRequest.current) setDetailError(failure.message || "Không thể tải chi tiết nhật ký"); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }

  return <ConfigProvider locale={viVN}><Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <Typography.Title level={2}>Nhật ký hoạt động</Typography.Title>
    <Card title="Tìm và lọc nhật ký">
      <Form layout="inline" onFinish={(values) => { setQuery(filters(values)); setPage(1); }}>
        {[['actorId', 'Mã người thực hiện hoặc SYSTEM'], ['entity', 'Loại đối tượng'], ['entityId', 'Mã đối tượng'], ['action', 'Hành động']].map(([name, label]) => <Form.Item key={name} name={name}><Input aria-label={label} placeholder={label} allowClear /></Form.Item>)}
        <Form.Item name="from" label="Từ giờ Việt Nam"><Input aria-label="Từ giờ Việt Nam" type="datetime-local" /></Form.Item>
        <Form.Item name="to" label="Đến giờ Việt Nam"><Input aria-label="Đến giờ Việt Nam" type="datetime-local" /></Form.Item>
        <Button htmlType="submit" type="primary">Lọc nhật ký</Button>
      </Form>
      <Button onClick={() => setRefresh((value) => value + 1)} loading={loading}>Tải lại nhật ký</Button>
    </Card>
    {error && <Alert type="error" title={error} showIcon />}
    <Table rowKey="id" loading={loading} dataSource={rows.items} locale={{ emptyText: <Empty description="Không có nhật ký phù hợp" /> }} pagination={{ current: page, pageSize, total: rows.total, showSizeChanger: true, onChange: (next, size) => { setPage(next); setPageSize(size); } }} columns={[
      { title: "Thời gian (Việt Nam)", dataIndex: "createdAt", render: (value) => new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) },
      { title: "Người thực hiện", dataIndex: "actorName" }, { title: "Hành động", dataIndex: "action" }, { title: "Loại đối tượng", dataIndex: "entity" }, { title: "Mã đối tượng", dataIndex: "entityId" }, { title: "IP", dataIndex: "ip" },
      { title: "Chi tiết", render: (_, row) => <Button onClick={() => inspect(row.id)}>Xem thay đổi</Button> },
    ]} />
    <Modal open={Boolean(detail)} title="Chi tiết nhật ký" width={900} onCancel={() => { ++detailRequest.current; setDetail(null); }} footer={<Button onClick={() => { ++detailRequest.current; setDetail(null); }}>Đóng</Button>}>
      {detailError && <Alert type="error" title={detailError} action={<Button onClick={() => inspect(detail.id)}>Thử lại</Button>} />}
      <Card loading={detailLoading}>
        {detail?.action && <Descriptions column={1} items={[{ key: "actor", label: "Người thực hiện", children: detail.actorName }, { key: "action", label: "Hành động", children: detail.action }, { key: "entity", label: "Đối tượng", children: `${detail.entity} · ${detail.entityId}` }, { key: "time", label: "Thời gian", children: new Date(detail.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) }]} />}
        {detail?.action && ["before", "after"].map((key) => <section key={key}><Typography.Title level={5}>{key === "before" ? "Trước thay đổi" : "Sau thay đổi"}</Typography.Title><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(detail[key], null, 2)}</pre></section>)}
      </Card>
    </Modal>
  </Space></ConfigProvider>;
}
