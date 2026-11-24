import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, ConfigProvider, Descriptions, Empty, Form, Input, Modal, Space, Table, Tag, Typography } from "antd";
import viVN from "antd/locale/vi_VN";
import { auditLogService } from "../../services/auditLogService";

const FIELD_LABELS = {
  id: "Mã bản ghi", userId: "Mã tài khoản", actorId: "Mã người thực hiện", unitId: "Mã đơn vị", periodId: "Mã đợt đánh giá",
  evaluationId: "Mã hồ sơ", criterionId: "Mã tiêu chí", entityId: "Mã đối tượng", refId: "Mã liên quan", refType: "Loại liên quan",
  username: "Tên đăng nhập", fullName: "Họ và tên", email: "Email", phone: "Số điện thoại", role: "Vai trò", unit: "Đơn vị",
  code: "Mã", name: "Tên", title: "Tiêu đề", body: "Nội dung", content: "Nội dung", description: "Mô tả", unitType: "Loại đơn vị",
  isActive: "Trạng thái tài khoản", mustChangePassword: "Yêu cầu đổi mật khẩu", phase: "Giai đoạn", status: "Trạng thái",
  createdAt: "Thời gian tạo", updatedAt: "Thời gian cập nhật", publishedAt: "Thời gian công bố", submittedAt: "Thời gian nộp",
  selfEvalStart: "Bắt đầu tự chấm", selfEvalDeadline: "Hạn tự chấm", finalizedAt: "Thời gian chốt", lastLoginAt: "Đăng nhập gần nhất",
  maxTotalScore: "Tổng điểm tối đa", maxScore: "Điểm tối đa", selfScore: "Điểm tự chấm", adminScore: "Điểm thẩm định",
  selfNote: "Diễn giải tự chấm", adminComment: "Nhận xét thẩm định", rating: "Mức xếp loại", label: "Tên mức xếp loại",
  minPercent: "Ngưỡng phần trăm", minExclusive: "Loại trừ ngưỡng", color: "Màu hiển thị", sortOrder: "Thứ tự hiển thị",
  type: "Loại", channels: "Kênh thông báo", isRead: "Trạng thái đã đọc", readAt: "Thời gian đọc", fileName: "Tên tệp",
  mimeType: "Định dạng tệp", sizeBytes: "Dung lượng (byte)", round: "Lượt đánh giá", attempt: "Số lần thử", lastError: "Lỗi gần nhất",
  before: "Trước thay đổi", after: "Sau thay đổi", ip: "Địa chỉ IP", count: "Số lượng", items: "Danh sách", results: "Kết quả",
  thresholds: "Các ngưỡng xếp loại", ratingThresholds: "Các ngưỡng xếp loại", criteria: "Các tiêu chí", evidences: "Minh chứng",
  enabled: "Đang bật", queuedChannels: "Kênh đang chờ gửi", deliveryStatus: "Trạng thái gửi",
};

const ENTITY_LABELS = {
  CredentialDelivery: "Lần gửi thông tin đăng nhập", CredentialDispatch: "Yêu cầu gửi thông tin đăng nhập", Criterion: "Tiêu chí",
  CriterionScore: "Điểm tiêu chí", Evaluation: "Hồ sơ đánh giá", EvaluationFeedback: "Trao đổi hồ sơ", EvaluationPeriod: "Đợt đánh giá",
  Evidence: "Minh chứng", ImportSession: "Phiên nhập tài khoản", Notification: "Thông báo", NotificationDelivery: "Lần gửi thông báo",
  ReportExport: "Lần xuất báo cáo", Unit: "Đơn vị", User: "Tài khoản",
};

const VALUE_LABELS = {
  ADMIN: "Quản trị viên", UNIT: "Đơn vị", SYSTEM: "Hệ thống",
  CREATE: "Tạo mới", UPDATE: "Cập nhật", DELETE: "Xóa", PUBLISH: "Công bố", FINALIZE: "Chốt kết quả",
  AUTO_STATUS: "Tự động cập nhật trạng thái", CREDENTIAL_DELIVERY_RETRIED: "Thử gửi lại thông tin đăng nhập",
  CREDENTIAL_EMAIL_CONFIRMED: "Xác nhận email nhận thông tin đăng nhập", FEEDBACK_CREATED: "Gửi trao đổi hồ sơ",
  FIRST_REVIEW_COMPLETE: "Hoàn tất thẩm định lần đầu", LOGIN_FAILED: "Đăng nhập thất bại", LOGIN_SUCCESS: "Đăng nhập thành công",
  NOTIFICATION_DELIVERY: "Gửi thông báo", NOTIFICATION_QUEUED: "Tạo thông báo", PASSWORD_CHANGED: "Đổi mật khẩu",
  REPORT_DOWNLOADED: "Tải báo cáo", REPORT_EXPORTED: "Xuất báo cáo", REVIEW_INVALIDATED: "Hủy kết quả thẩm định",
  REVIEW_SCORE: "Thẩm định điểm", SELF_SCORE: "Tự chấm điểm", SUBMIT: "Nộp hồ sơ", SUPPLEMENT_REQUEST: "Yêu cầu bổ sung",
  SUPPLEMENT_SUBMIT: "Nộp bổ sung", TRANSITION_PHASE: "Chuyển giai đoạn", UPSERT_THRESHOLDS: "Cập nhật ngưỡng xếp loại",
  UNITS_IMPORTED: "Nhập danh sách đơn vị", UNIT_CREATED: "Tạo đơn vị", UNIT_UPDATED: "Cập nhật đơn vị",
  USER_ACTIVATED: "Mở tài khoản", USER_CREATED: "Tạo tài khoản", USER_DEACTIVATED: "Khóa tài khoản",
  USER_IMPORTED: "Nhập tài khoản", USER_PASSWORD_RESET: "Đặt lại mật khẩu", USER_UPDATED: "Cập nhật tài khoản",
  DRAFT: "Bản nháp", PENDING_REVIEW: "Chờ thẩm định", SUPPLEMENT_REQUESTED: "Được yêu cầu bổ sung",
  SUPPLEMENT_SUBMITTED: "Đã nộp bổ sung", SUPPLEMENT_EXPIRED: "Hết hạn bổ sung", FINALIZED: "Đã chốt",
  SETUP: "Thiết lập", SELF_EVAL: "Tự chấm", FIRST_REVIEW: "Thẩm định lần đầu", SUPPLEMENT: "Bổ sung",
  FINAL_REVIEW: "Thẩm định cuối", CLOSED: "Đã đóng", EXCELLENT: "Xuất sắc", GOOD: "Tốt", PASS: "Đạt", FAIL: "Chưa đạt",
  WEB_PUSH: "Thông báo trình duyệt", EMAIL: "Email", ZALO_ZNS: "Zalo", TEST: "Thông báo kiểm tra",
  GENERAL: "Nhận xét chung", EXPLANATION_REQUEST: "Yêu cầu giải trình", UNIT_REPLY: "Đơn vị phản hồi",
  INITIAL: "Tự chấm", FILE: "Tệp", LINK: "Liên kết", QUEUED: "Đang chờ gửi", SENT: "Đã gửi", FAILED: "Gửi thất bại",
  CONG_AN_QUAN_HUYEN: "Công an quận/huyện", PHONG_NGHIEP_VU: "Phòng nghiệp vụ", DON_VI_TRUC_THUOC: "Đơn vị trực thuộc",
  "[ĐÃ CHE]": "Thông tin đã được ẩn",
};

function fieldLabel(key) {
  return FIELD_LABELS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

function displayValue(value, field) {
  if (value === null || value === undefined || value === "") return <Typography.Text type="secondary">Không có</Typography.Text>;
  if (typeof value === "boolean") {
    if (field === "isActive") return value ? "Đang hoạt động" : "Đã khóa";
    if (field === "mustChangePassword") return value ? "Có" : "Không";
    return value ? "Có" : "Không";
  }
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "string") {
    if (value === "[ĐÃ CHE]") return "Thông tin đã được ẩn";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value) && Number.isFinite(Date.parse(value))) {
      return new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    }
    if (VALUE_LABELS[value]) return VALUE_LABELS[value];
    if (/^[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+$/u.test(value)) return value.split("_").map((part) => part.toLowerCase()).join(" ");
    return value;
  }
  return null;
}

function SnapshotValue({ value, field }) {
  if (Array.isArray(value)) {
    if (!value.length) return <Typography.Text type="secondary">Không có</Typography.Text>;
    if (value.every((item) => item === null || typeof item !== "object")) {
      return <Space wrap>{value.map((item, index) => <Tag key={`${String(item)}-${index}`}>{displayValue(item, field)}</Tag>)}</Space>;
    }
    return <Space orientation="vertical" style={{ width: "100%" }}>{value.map((item, index) => <Card key={item?.id ?? index} size="small" title={`Mục ${index + 1}`} style={{ width: "100%" }}><SnapshotValue value={item} /></Card>)}</Space>;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return <Typography.Text type="secondary">Không có</Typography.Text>;
    return <Descriptions bordered size="small" column={1} items={entries.map(([key, child]) => ({ key, label: fieldLabel(key), children: <SnapshotValue value={child} field={key} /> }))} />;
  }
  return displayValue(value, field);
}

function actionLabel(value) { return VALUE_LABELS[value] ?? value ?? "Không có"; }
function entityLabel(value) { return ENTITY_LABELS[value] ?? value ?? "Không có"; }

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
      { title: "Người thực hiện", dataIndex: "actorName" }, { title: "Hành động", dataIndex: "action", render: actionLabel }, { title: "Loại đối tượng", dataIndex: "entity", render: entityLabel }, { title: "Mã đối tượng", dataIndex: "entityId" }, { title: "IP", dataIndex: "ip", render: (value) => value || "Không có" },
      { title: "Chi tiết", render: (_, row) => <Button onClick={() => inspect(row.id)}>Xem thay đổi</Button> },
    ]} />
    <Modal open={Boolean(detail)} title="Chi tiết nhật ký" width={900} onCancel={() => { ++detailRequest.current; setDetail(null); }} footer={<Button onClick={() => { ++detailRequest.current; setDetail(null); }}>Đóng</Button>}>
      {detailError && <Alert type="error" title={detailError} action={<Button onClick={() => inspect(detail.id)}>Thử lại</Button>} />}
      <Card loading={detailLoading}>
        {detail?.action && <Descriptions column={1} items={[{ key: "actor", label: "Người thực hiện", children: detail.actorName || "Không có" }, { key: "action", label: "Hành động", children: actionLabel(detail.action) }, { key: "entity", label: "Đối tượng", children: `${entityLabel(detail.entity)} · ${detail.entityId || "Không có"}` }, { key: "time", label: "Thời gian", children: detail.createdAt ? new Date(detail.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Không có" }]} />}
        {detail?.action && ["before", "after"].map((key) => <Card key={key} size="small" title={key === "before" ? "Trước thay đổi" : "Sau thay đổi"} style={{ marginTop: 16 }}><SnapshotValue value={detail[key]} /></Card>)}
      </Card>
    </Modal>
  </Space></ConfigProvider>;
}
