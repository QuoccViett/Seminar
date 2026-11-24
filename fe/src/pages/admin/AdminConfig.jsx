import { useState, useEffect } from "react";
import { applyFormError } from "../../services/formErrors";
import { allPages } from "../../services/pagination";
import { 
  Card, Form, Input, InputNumber, DatePicker, Button, Tabs, message,
  Row, Col, Typography, Divider, Space, Table, Tag, Modal, Switch, Popconfirm, Select, Alert, ConfigProvider
} from "antd";
import { 
  SaveOutlined, SettingOutlined, PlusOutlined, EditOutlined, DeleteOutlined, ArrowLeftOutlined 
} from "@ant-design/icons";
import dayjs from "dayjs";
import viVN from "antd/locale/vi_VN";
import "dayjs/locale/vi";
import { evaluationPeriodService } from "../../services/evaluationPeriodService";
import { criteriaService } from "../../services/criteriaService";
import styles from "./AdminConfig.module.css";

const { Title, Text } = Typography;
const phaseLabels = { SETUP: "Thiết lập", SELF_EVAL: "Tự chấm", FIRST_REVIEW: "Thẩm định lần đầu", SUPPLEMENT: "Bổ sung", FINAL_REVIEW: "Thẩm định cuối", CLOSED: "Đã đóng" };

/** Cấp bộ giá trị khởi tạo bốn mức đã thống nhất cho biểu mẫu Admin
 * Gọi mỗi lần mở kỳ mới để tránh rò rỉ lựa chọn từ kỳ trước
 * Các mức vẫn được máy chủ xác thực trước khi lưu hoặc công bố
 */
function defaultThresholdValues() {
  return {
    EXCELLENT: { label: "Xuất sắc", minPercent: 85, minExclusive: true, color: "#16a34a" },
    GOOD: { label: "Tốt", minPercent: 65, minExclusive: false, color: "#2563eb" },
    PASS: { label: "Đạt", minPercent: 50, minExclusive: false, color: "#d97706" },
    FAIL: { label: "Chưa đạt", minPercent: 0, minExclusive: false, color: "#dc2626" },
  };
}

/** Chuyển object biểu mẫu thành mảng theo mã mức mà API nhận
 * thresholds là nhóm field do Form quản lý theo từng mã kỹ thuật
 * Thứ tự cố định giữ request ổn định và mỗi ngưỡng mang cả cận lẫn nhãn/màu
 */
function thresholdPayload(thresholds) {
  return ["EXCELLENT", "GOOD", "PASS", "FAIL"].map((rating) => ({ rating, label: thresholds[rating].label, minPercent: thresholds[rating].minPercent, minExclusive: rating === "EXCELLENT", color: thresholds[rating].color ?? null }));
}

/** Hiển thị một instant UTC trong bộ chọn như giờ lịch Việt Nam UTC+07
 * value là chuỗi ISO do API trả về
 * Tạo dayjs từ thành phần lịch Việt Nam để màn hình không đổi theo múi giờ thiết bị
 */
function toVietnamDatePicker(value) {
  if (!value) return null;
  const vietnam = new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000);
  return dayjs(new Date(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate(), vietnam.getUTCHours(), vietnam.getUTCMinutes(), vietnam.getUTCSeconds(), vietnam.getUTCMilliseconds()));
}

/** Đổi các thành phần giờ Việt Nam đã chọn thành instant UTC gửi API
 * value là dayjs có các thành phần giờ đang hiển thị trong DatePicker
 * Dùng UTC constructor trừ bảy giờ để không phụ thuộc múi giờ máy Admin
 */
function fromVietnamDatePicker(value) {
  if (!value) return null;
  return new Date(Date.UTC(value.year(), value.month(), value.date(), value.hour() - 7, value.minute(), value.second(), value.millisecond())).toISOString();
}

/** Giữ Enter trong bộ chọn lịch để xác nhận ngày giờ mà không gửi form đang chứa nó
 * Sự kiện bàn phím đến từ RangePicker, chỉ chặn hành vi submit mặc định của trình duyệt
 * Picker vẫn nhận phím để hoàn tất lựa chọn, Tab và nút lưu biểu mẫu tiếp tục hoạt động bình thường
 * Tránh lưu kỳ với lịch null khi trạng thái khoảng ngày chưa kịp được picker xác nhận
 */
function keepPickerSelection(event) {
  if (event.key === "Enter") event.preventDefault();
}

/** Quản lý kỳ, cây tiêu chí, ngưỡng và lệnh giai đoạn bằng API thật
 * Các cờ chỉnh sửa và đích chuyển giai đoạn lấy từ server, không dùng giờ máy cấp quyền
 * Lịch bổ sung ở đây chỉ xem trước phương án tạm, yêu cầu hồ sơ thuộc VC12
 */
export default function AdminConfig() {
  // ================= QUẢN LÝ LUỒNG (WIZARD) =================
  const [activeTab, setActiveTab] = useState("1"); // Mặc định mở Tab 1
  const [currentPeriodId, setCurrentPeriodId] = useState(null); // Lưu ID kỳ thi đang thao tác

  // ================= STATE DỮ LIỆU =================
  const [periodsList, setPeriodsList] = useState([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);

  const [criteriaList, setCriteriaList] = useState([]);
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  const [isCriteriaModalOpen, setIsCriteriaModalOpen] = useState(false);
  const [selectedCriterion, setSelectedCriterion] = useState(null);
  const [phaseDialog, setPhaseDialog] = useState(null);
  const [deletingPeriodId, setDeletingPeriodId] = useState(null);
  const [supplementStart, setSupplementStart] = useState(null);
  const [supplementEnd, setSupplementEnd] = useState(null);
  const [supplementPreview, setSupplementPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ================= STATE FORM =================
  const [formPeriod] = Form.useForm();
  const [formCriteria] = Form.useForm();
  const [formThresholds] = Form.useForm();
  const currentPeriod = periodsList.find((period) => period.id === currentPeriodId);

  // ================= GỌI API =================
  // 1. Lấy danh sách kỳ thi khi vào trang
  useEffect(() => {
    fetchPeriods();
  }, []);

  /** Tải danh sách thật từ API và giữ trạng thái đang tải cho bảng
   * Không nhận kỳ giả hoặc tự suy ra trạng thái từ đồng hồ trình duyệt
   * Thông báo lỗi lấy message đã được apiClient chuẩn hóa sang tiếng Việt
   */
  const fetchPeriods = async () => {
    try {
      setLoadingPeriods(true);
      const items = await allPages((params) => evaluationPeriodService.getEvaluationPeriods(params));
      setPeriodsList(items);
    } catch (error) {
      message.error(error.message || "Không thể tải danh sách kỳ đánh giá");
    } finally {
      setLoadingPeriods(false);
    }
  };

  // 2. Lấy danh sách tiêu chí khi đã có ID kỳ thi
  /** Tải cấu hình tiêu chí cho kỳ được chọn bằng endpoint có phân quyền backend
   * periodId là UUID của kỳ nháp đang được Admin cấu hình
   * Mảng rỗng là phản hồi hợp lệ khi chưa có tiêu chí
   */
  const fetchCriteria = async (periodId) => {
    if (!periodId) return;
    try {
      setLoadingCriteria(true);
      const res = await criteriaService.getCriteria(periodId);
      setCriteriaList(Array.isArray(res) ? res : res.items || []);
    } catch (error) {
      message.error(error.message || "Không thể tải danh sách tiêu chí");
    } finally {
      setLoadingCriteria(false);
    }
  };

  // ================= XỬ LÝ CHUYỂN BƯỚC =================
  /** Mở biểu mẫu tạo kỳ nháp và xóa dữ liệu còn sót từ lần cấu hình trước
   * Không chọn sẵn khoảng ngày bằng năm hiện tại để Admin phải đặt lịch chủ động
   */
  const handleCreateNew = () => {
    setCurrentPeriodId(null);
    formPeriod.resetFields();
    formThresholds.setFieldsValue({ thresholds: defaultThresholdValues() });
    setActiveTab("2"); // Nhảy sang Tab 2
  };

  /** Nạp dữ liệu kỳ đã chọn vào biểu mẫu mà không dùng giờ máy để cấp quyền
   * record lấy từ API gồm các mốc UTC có thể rỗng
   * Các mốc chỉ được chuyển sang dayjs để hiển thị/chỉnh trong bộ chọn ngày giờ
   */
  const handleEditPeriod = (record) => {
    setCurrentPeriodId(record.id);
    formPeriod.setFieldsValue({
      name: record.name,
      year: record.year,
      maxTotalScore: record.maxTotalScore,
      changeReason: undefined,
      selfEvalRange: record.selfEvalStart && record.selfEvalDeadline
        ? [toVietnamDatePicker(record.selfEvalStart), toVietnamDatePicker(record.selfEvalDeadline)]
        : null,
    });
    formThresholds.setFieldsValue({ thresholds: record.ratingThresholds?.length
      ? Object.fromEntries(record.ratingThresholds.map((threshold) => [threshold.rating, threshold]))
      : defaultThresholdValues() });
    void fetchCriteria(record.id);
    setActiveTab("2"); // Nhảy sang Tab 2
  };

  /** Quay về danh sách và tải lại trạng thái đã lưu từ máy chủ
   * Không giữ bản ghi cục bộ làm nguồn dữ liệu sau khi rời bước cấu hình
   */
  const handleBackToList = () => {
    setActiveTab("1");
    fetchPeriods(); // Cập nhật lại danh sách đề phòng có thay đổi
  };

  // ================= XỬ LÝ LƯU KỲ THI (TAB 2) =================
  /** Tạo hoặc cập nhật kỳ nháp rồi lưu trọn bộ ngưỡng trước khi mở bước tiêu chí
   * values đến từ form có mốc ngày giờ tùy chọn; backend quyết định thời điểm và quyền
   * Nếu một request lỗi, không chuyển tab và hiển thị thông điệp tiếng Việt từ API
   */
  const onFinishPeriod = async (values) => {
    try {
      setLoadingPeriods(true);
      const payload = {
        name: values.name,
        year: values.year,
        maxTotalScore: values.maxTotalScore,
        selfEvalStart: fromVietnamDatePicker(values.selfEvalRange?.[0]),
        selfEvalDeadline: fromVietnamDatePicker(values.selfEvalRange?.[1]),
        ...(values.changeReason?.trim() ? { changeReason: values.changeReason.trim() } : {}),
      };

      const result = currentPeriodId
        ? await evaluationPeriodService.updateEvaluationPeriod(currentPeriodId, payload)
        : await evaluationPeriodService.createEvaluationPeriod(payload);
      const targetPeriodId = result?.id || currentPeriodId;
      // Ghi nhớ kỳ vừa tạo trước request ngưỡng để retry không tạo thêm kỳ khi lưu ngưỡng lỗi
      setCurrentPeriodId(targetPeriodId);
      const thresholdValues = formThresholds.getFieldValue("thresholds") || defaultThresholdValues();
      if (!periodsList.find((period) => period.id === targetPeriodId)?.publishedAt) {
        await evaluationPeriodService.saveThresholds(targetPeriodId, thresholdPayload(thresholdValues));
      }
      
      message.success("Đã lưu cấu hình kỳ và ngưỡng xếp loại");
      setCurrentPeriodId(targetPeriodId);
      setActiveTab("3");
      await fetchPeriods();
      await fetchCriteria(targetPeriodId);

    } catch (error) {
      message.error(applyFormError(formPeriod, error, "Không thể lưu cấu hình kỳ đánh giá", { selfEvalStart: "selfEvalRange", selfEvalDeadline: "selfEvalRange" }));
    } finally {
      setLoadingPeriods(false);
    }
  };

  // ================= XỬ LÝ LƯU TIÊU CHÍ (TAB 3) =================
  /** Tạo mới hoặc cập nhật tiêu chí bằng API thật theo lựa chọn trong bảng
   * values chứa nội dung tiêu chí còn selectedCriterion xác định thao tác sửa hay thêm
   * Sau khi lưu, tải lại cây từ backend và đóng biểu mẫu khi request thành công
   */
  const onFinishCriteria = async (values) => {
    try {
      // Xóa lựa chọn cha cần gửi null khi PATCH để đưa nút về gốc tường minh
      const payload = { ...values, parentId: values.parentId ?? null };
      if (selectedCriterion) await criteriaService.updateCriteria(currentPeriodId, selectedCriterion.id, payload);
      else await criteriaService.createCriteria(currentPeriodId, payload);
      message.success(selectedCriterion ? "Đã cập nhật tiêu chí" : "Đã thêm tiêu chí");
      setIsCriteriaModalOpen(false);
      setSelectedCriterion(null);
      formCriteria.resetFields();
      await fetchCriteria(currentPeriodId);
    } catch (error) {
      message.error(applyFormError(formCriteria, error, "Không thể lưu tiêu chí"));
    }
  };

  /** Lưu bộ ngưỡng chuẩn sau khi Admin thay đổi các mức trong biểu mẫu
   * values chứa nhãn/màu và cận từng mức xếp loại
   * API thay nguyên tử toàn bộ bốn mức và từ chối nếu kỳ đã công bố
   */
  const onFinishThresholds = async (values) => {
    try {
      await evaluationPeriodService.saveThresholds(currentPeriodId, thresholdPayload(values.thresholds));
      message.success("Đã lưu bốn ngưỡng xếp loại");
    } catch (error) {
      message.error(applyFormError(formThresholds, error, "Không thể lưu ngưỡng xếp loại"));
    }
  };

  /** Công bố kỳ sau khi backend xác nhận đã đủ lịch, tiêu chí và ngưỡng
   * record là kỳ do bảng tải từ API
   * Chỉ thông báo thành công sau phản hồi máy chủ, không giả lập trạng thái công bố
   */
  const handlePublish = async (record) => {
    try {
      const check = await evaluationPeriodService.getPublishCheck(record.id);
      if (!check.canPublish) {
        Modal.info({
          title: "Chưa đủ điều kiện công bố",
          content: <ul>{check.checks.filter((item) => !item.passed).map((item) => <li key={item.code}>{item.message}</li>)}</ul>,
          okText: "Đã hiểu",
        });
        return;
      }
      await evaluationPeriodService.publishEvaluationPeriod(record.id);
      message.success("Đã công bố kỳ đánh giá");
      await fetchPeriods();
    } catch (error) {
      message.error(error.message || "Không thể công bố kỳ đánh giá");
    }
  };

  /** Xóa kỳ nháp và cấu hình tiêu chí/ngưỡng sau khi Admin xác nhận
   * Backend từ chối kỳ đã công bố hoặc đã có hồ sơ/báo cáo, FE tải lại danh sách sau thành công
   */
  const handleDeletePeriod = async (record) => {
    setDeletingPeriodId(record.id);
    try {
      await evaluationPeriodService.deleteEvaluationPeriod(record.id);
      if (currentPeriodId === record.id) {
        setCurrentPeriodId(null);
        setCriteriaList([]);
        formPeriod.resetFields();
        formThresholds.resetFields();
      }
      message.success(`Đã xóa kỳ nháp ${record.name} (${record.year})`);
      await fetchPeriods();
    } catch (error) {
      message.error(error.message || "Không thể xóa kỳ nháp");
    } finally {
      setDeletingPeriodId(null);
    }
  };

  /** Xóa tiêu chí đã chọn và đồng bộ bảng với kết quả API
   * record là dòng tiêu chí thuộc kỳ hiện tại
   * Nếu có quan hệ con/điểm hoặc kỳ đã công bố, thông báo backend được giữ nguyên
   */
  const handleDeleteCriterion = async (record) => {
    try {
      await criteriaService.deleteCriteria(currentPeriodId, record.id);
      message.success("Đã xóa tiêu chí");
      await fetchCriteria(currentPeriodId);
    } catch (error) {
      message.error(error.message || "Không thể xóa tiêu chí");
    }
  };

  /** Tải điều kiện hiện tại rồi mở hộp xác nhận giai đoạn của kỳ được chọn
   * record đến từ API, quyền cuối cùng được kiểm lại khi người dùng xác nhận lệnh
   */
  const showPhaseOptions = async (record) => {
    try { setPhaseDialog({ record, ...await evaluationPeriodService.getPhaseOptions(record.id) }); }
    catch (error) { message.error(error.message || "Không thể tải điều kiện chuyển giai đoạn"); }
  };

  /** Gửi lệnh đã xác nhận và đồng bộ lại danh sách sau commit
   * Không sửa phase cục bộ khi backend từ chối do giờ hoặc hồ sơ đã thay đổi
   */
  const changePhase = async (phase) => {
    try {
      await evaluationPeriodService.transitionPhase(phaseDialog.record.id, phase);
      message.success("Đã chuyển giai đoạn kỳ đánh giá");
      setPhaseDialog(null);
      await fetchPeriods();
    } catch (error) { message.error(error.message || "Không thể chuyển giai đoạn"); }
  };

  /** Xin hạn xem trước theo lựa chọn hiện tại, giữ kết quả backend làm nguồn duy nhất
   * Lựa chọn bị xóa thì xóa preview, lỗi không giữ hạn cũ khiến Admin hiểu nhầm
   */
  const previewSupplement = async () => {
    if (!supplementStart || !supplementEnd) return;
    setPreviewLoading(true);
    setSupplementPreview(null);
    try { setSupplementPreview(await evaluationPeriodService.previewSupplementSchedule(fromVietnamDatePicker(supplementStart), fromVietnamDatePicker(supplementEnd))); }
    catch (error) { message.error(error.message || "Không thể xem trước lịch bổ sung"); }
    finally { setPreviewLoading(false); }
  };

  /** Liệt kê các nút cha theo cây đang hiển thị để Admin tạo hoặc di chuyển tiêu chí
   * Backend vẫn kiểm cùng kỳ, vòng lặp và độ sâu khi gửi, kể cả cấu hình đổi đồng thời
   */
  const parentOptions = (nodes, prefix = "") => nodes.flatMap((node) => [
    { value: node.id, label: `${prefix}${node.code} — ${node.name}`, disabled: node.id === selectedCriterion?.id },
    ...parentOptions(node.children || [], `${prefix}— `),
  ]);

  // ================= GIAO DIỆN TAB 1: DANH SÁCH =================
  const periodColumns = [
    { title: "Tên Kỳ thi", dataIndex: "name", key: "name" }, 
    { title: "Năm", dataIndex: "year", key: "year", width: 100, align: "center" },
    { 
      title: "Trạng thái", 
      dataIndex: "phase", 
      key: "phase", 
      render: (p, record) => <Tag color={record.publishedAt ? "green" : "orange"}>{record.publishedAt ? phaseLabels[p] : "Nháp"}</Tag>
    },
    {
      title: "Hành động",
      key: "action",
      width: 420,
      align: "center",
      render: (_, record) => (
        <div className={styles.periodActions}>
          <Button type="primary" ghost icon={<EditOutlined />} onClick={() => handleEditPeriod(record)}>Cấu hình</Button>
          {record.publishedAt && <Button onClick={() => showPhaseOptions(record)}>Giai đoạn</Button>}
          {!record.publishedAt && (
            <>
              <Popconfirm title="Công bố kỳ đánh giá?" description="Đơn vị chỉ thấy tiêu chí từ đúng thời điểm mở đã cấu hình" onConfirm={() => handlePublish(record)} okText="Công bố" cancelText="Hủy">
                <Button type="primary">Công bố</Button>
              </Popconfirm>
              <Popconfirm
                title={`Xóa kỳ nháp ${record.name} (${record.year})?`}
                description="Thao tác này cũng xóa tiêu chí và ngưỡng của kỳ. Chỉ xóa được khi chưa có hồ sơ hoặc báo cáo."
                onConfirm={() => handleDeletePeriod(record)}
                okText="Xóa kỳ nháp"
                cancelText="Hủy"
                okButtonProps={{ danger: true, loading: deletingPeriodId === record.id }}
              >
                <Button danger icon={<DeleteOutlined />} loading={deletingPeriodId === record.id}>Xóa nháp</Button>
              </Popconfirm>
            </>
          )}
        </div>
      ),
    },
  ];

  const TabList = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <Title level={5} style={{ margin: 0 }}>Danh sách Kỳ thi đua</Title>
          <Text type="secondary">Quản lý các đợt đánh giá thi đua của hệ thống</Text>
        </div>
        <Button type="primary" size="large" icon={<PlusOutlined />} onClick={handleCreateNew}>
          Tạo kỳ thi mới
        </Button>
      </div>
      <Table columns={periodColumns} dataSource={periodsList} rowKey="id" loading={loadingPeriods} scroll={{ x: 850 }} />
      <Divider />
      <Space orientation="vertical">
        <Title level={5}>Lịch bổ sung</Title>
        <Text>Chỉ xem trước; gửi yêu cầu tại màn thẩm định hồ sơ</Text>
        <Text>Chọn ngày giờ bắt đầu và kết thúc bất kỳ, kể cả cuối tuần (giờ Việt Nam)</Text>
        <Space wrap>
          <DatePicker aria-label="Ngày giờ mở bổ sung" placeholder="Chọn ngày giờ mở bổ sung" showTime={{ format: "HH:mm" }} format="DD/MM/YYYY HH:mm"
            value={supplementStart} disabled={previewLoading}
            onChange={(value) => { setSupplementStart(value); setSupplementPreview(null); }} />
          <DatePicker aria-label="Ngày giờ kết thúc bổ sung" placeholder="Chọn ngày giờ kết thúc bổ sung" showTime={{ format: "HH:mm" }} format="DD/MM/YYYY HH:mm" value={supplementEnd} disabled={previewLoading} onChange={(value) => { setSupplementEnd(value); setSupplementPreview(null); }} />
          <Button onClick={previewSupplement} loading={previewLoading} disabled={!supplementStart || !supplementEnd}>Xem trước hạn bổ sung</Button>
        </Space>
        {supplementPreview && <Alert type="info" title={`${supplementPreview.notice}: ${supplementPreview.displayUntil} (giờ Việt Nam)`} />}
      </Space>
    </div>
  );

  // ================= GIAO DIỆN TAB 2: THÔNG TIN =================
  const TabGeneral = (
    <div className={styles.formContainer}>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={handleBackToList} style={{ marginBottom: 16, padding: 0 }}>
        Quay lại danh sách
      </Button>

      <Form 
        name="vc08-period"
        form={formPeriod} 
        layout="vertical" 
        onFinish={onFinishPeriod}
        initialValues={{
          year: dayjs().year(),
          maxTotalScore: 300,
          selfEvalRange: null,
        }}
        style={{ maxWidth: 1000 }}
      >
        <Space align="center" style={{ marginBottom: 16 }}>
          <SettingOutlined style={{ color: "var(--app-primary)", fontSize: 18 }} />
          <Title level={5} style={{ margin: 0 }}>Thông tin cơ bản</Title>
        </Space>
        
        <Row gutter={32}>
          <Col span={12}>
            <Form.Item label="Tên kỳ thi đua" name="name" rules={[{ required: true, message: "Vui lòng nhập tên" }]}>
              <Input size="large" placeholder="VD: Thi đua công tác Đoàn năm 2026" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Năm thi đua" name="year" rules={[{ required: true, message: "Vui lòng nhập năm đánh giá" }]}>
              <InputNumber size="large" style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>

        <Divider style={{ margin: "12px 0 24px 0" }} />

        <Space align="center" style={{ marginBottom: 16 }}>
          <SettingOutlined style={{ color: "var(--app-primary)", fontSize: 18 }} />
          <Title level={5} style={{ margin: 0 }}>Cấu hình thời gian & Điểm số</Title>
        </Space>

        <Row gutter={32}>
          <Col span={10}>
            <Form.Item label="Thời gian mở/đóng tự chấm (giờ Việt Nam UTC+07:00)" name="selfEvalRange">
              <DatePicker.RangePicker showTime={{ format: "HH:mm" }} format="DD/MM/YYYY HH:mm" size="large" placeholder={["Ngày giờ mở", "Ngày giờ kết thúc"]} onKeyDown={keepPickerSelection} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={14}>
            <Form.Item label="Tổng điểm tối đa" name="maxTotalScore" rules={[{ required: true, message: "Vui lòng nhập tổng điểm tối đa" }]}>
              <InputNumber size="large" min={1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="changeReason" label="Lý do thay đổi lịch đã công bố">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>

        <Divider style={{ margin: "24px 0" }} />

        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" size="large" htmlType="submit" icon={<SaveOutlined />} loading={loadingPeriods} disabled={currentPeriod?.canEditConfiguration === false} className={styles.btnSave}>
            Lưu và chuyển sang Tiêu chí
          </Button>
        </Form.Item>
      </Form>

      {/* Bộ ngưỡng cố định theo quy ước được lưu nguyên bộ trước công bố */}
      <Form disabled={!!periodsList.find((period) => period.id === currentPeriodId)?.publishedAt} name="vc08-thresholds" form={formThresholds} layout="vertical" initialValues={{ thresholds: defaultThresholdValues() }} onFinish={onFinishThresholds}>
        <Space align="center" style={{ marginBottom: 16 }}>
          <SettingOutlined style={{ color: "var(--app-primary)", fontSize: 18 }} />
          <Title level={5} style={{ margin: 0 }}>Ngưỡng xếp loại</Title>
        </Space>
        <Row gutter={16}>
          {["EXCELLENT", "GOOD", "PASS", "FAIL"].map((rating) => (
            <Col xs={24} sm={12} lg={6} key={rating}>
              <Text strong>{rating}</Text>
              <Form.Item name={["thresholds", rating, "label"]} label="Nhãn" rules={[{ required: true, message: "Vui lòng nhập nhãn" }]}>
                <Input />
              </Form.Item>
              <Form.Item name={["thresholds", rating, "minPercent"]} label="Điểm tối thiểu (%)" dependencies={[["thresholds", "PASS", "minPercent"], ["thresholds", "GOOD", "minPercent"], ["thresholds", "EXCELLENT", "minPercent"]]} rules={[({ getFieldValue }) => ({ validator() {
                  const t = getFieldValue("thresholds");
                  return t && t.FAIL.minPercent === 0 && t.PASS.minPercent > 0 && t.PASS.minPercent < t.GOOD.minPercent && t.GOOD.minPercent < t.EXCELLENT.minPercent && t.EXCELLENT.minPercent < 100 ? Promise.resolve() : Promise.reject(new Error("Cần 0 < Đạt < Tốt < Xuất sắc < 100"));
                } })]}>
                <InputNumber aria-label={`Ngưỡng ${rating}`} min={0} max={rating === "EXCELLENT" ? 99.99 : 100} precision={2} style={{ width: "100%" }} disabled={rating === "FAIL" || !currentPeriodId || !!periodsList.find((period) => period.id === currentPeriodId)?.publishedAt} />
              </Form.Item>
              <Form.Item name={["thresholds", rating, "color"]} label="Màu">
                <Input />
              </Form.Item>
            </Col>
          ))}
        </Row>
        <Space>
          <Button htmlType="submit" disabled={!currentPeriodId || periodsList.find((period) => period.id === currentPeriodId)?.publishedAt}>Lưu ngưỡng</Button>
          <Text type="secondary">Mặc định 85/65/50/0. Cần 0 &lt; PASS &lt; GOOD &lt; EXCELLENT &lt; 100; Xuất sắc dùng &gt;, các mức còn lại dùng ≥. Khóa sau công bố.</Text>
        </Space>
      </Form>
    </div>
  );

  // ================= GIAO DIỆN TAB 3: TIÊU CHÍ =================
  const criteriaColumns = [
    { title: "Mã", dataIndex: "code", key: "code", width: 80, render: (text) => <strong>{text}</strong> },
    { title: "Tên tiêu chí", dataIndex: "name", key: "name" },
    { title: "Điểm tối đa", dataIndex: "maxScore", key: "maxScore", align: "center", render: (score) => <Tag color="blue">{score} điểm</Tag> },
    { title: "Yêu cầu minh chứng", dataIndex: "evidenceRequirement", key: "evidenceRequirement", ellipsis: true },
    {
      title: "Hành động", key: "action", align: "center", width: 120,
      render: (_, record) => (
        <Space size="small">
          <Button type="text" disabled={periodsList.find((period) => period.id === currentPeriodId)?.publishedAt} icon={<EditOutlined style={{ color: "var(--app-primary)" }} />} onClick={() => { setSelectedCriterion(record); formCriteria.setFieldsValue(record); setIsCriteriaModalOpen(true); }} />
          <Popconfirm title="Xóa tiêu chí này?" onConfirm={() => handleDeleteCriterion(record)} okText="Xóa" cancelText="Hủy">
            <Button type="text" danger disabled={periodsList.find((period) => period.id === currentPeriodId)?.publishedAt} icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const TabCriteria = (
    <div className={styles.formContainer}>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={handleBackToList} style={{ marginBottom: 16, padding: 0 }}>
        Hoàn tất & Quay lại danh sách
      </Button>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <Title level={5} style={{ margin: 0 }}>Danh sách Tiêu chí chấm điểm</Title>
          <Text type="secondary">Cấu hình thang điểm chi tiết cho kỳ thi đang chọn</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} disabled={periodsList.find((period) => period.id === currentPeriodId)?.publishedAt} onClick={() => { setSelectedCriterion(null); formCriteria.resetFields(); setIsCriteriaModalOpen(true); }}>
          Thêm tiêu chí
        </Button>
      </div>

      <div className={styles.tableContainer}>
        <Table 
          columns={criteriaColumns} 
          dataSource={criteriaList} 
          rowKey="id"
          loading={loadingCriteria}
          pagination={{ pageSize: 10 }}
        />
      </div>

      {/* MODAL THÊM TIÊU CHÍ */}
      <Modal
        title={selectedCriterion ? "Cập nhật tiêu chí chấm điểm" : "Thêm tiêu chí chấm điểm mới"}
        open={isCriteriaModalOpen}
        onCancel={() => { setIsCriteriaModalOpen(false); setSelectedCriterion(null); formCriteria.resetFields(); }}
        onOk={() => formCriteria.submit()}
        okText="Lưu tiêu chí"
        cancelText="Hủy"
        width={700}
      >
        <Form 
          name="vc08-criterion"
          form={formCriteria} 
          layout="vertical" 
          onFinish={onFinishCriteria} 
          initialValues={{ allowText: true, allowFile: true, allowLink: true, evidenceRequired: true }}
          style={{ marginTop: 20 }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="code" label="Mã tiêu chí" rules={[{ required: true, message: "Nhập mã" }]}>
                <Input placeholder="VD: 1.1" />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="name" label="Tên tiêu chí" rules={[{ required: true, message: "Nhập tên" }]}>
                <Input placeholder="VD: Công tác tuyên truyền" />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="maxScore" label="Điểm tối đa" rules={[{ required: true, message: "Nhập điểm" }]}>
                <InputNumber min={0.01} precision={2} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="evidenceRequirement" label="Yêu cầu minh chứng">
                <Input placeholder="VD: Báo cáo, hình ảnh..." />
              </Form.Item>
            </Col>
          </Row>

          {/* Cha và thứ tự được gửi tường minh để cây ổn định khi tạo và sau tải lại */}
          <Form.Item name="parentId" label="Tiêu chí cha">
            <Select allowClear placeholder="Để trống nếu là tiêu chí gốc" options={parentOptions(criteriaList)} />
          </Form.Item>
          <Form.Item name="sortOrder" label="Thứ tự hiển thị" initialValue={1} rules={[{ required: true, message: "Vui lòng nhập thứ tự hiển thị" }]}>
            <InputNumber precision={0} />
          </Form.Item>
          <Form.Item name="description" label="Mô tả chi tiết">
            <Input.TextArea rows={2} placeholder="Nhập mô tả nếu có..." />
          </Form.Item>

          <Divider titlePlacement="left" plain>Quyền minh chứng</Divider>
          
          <Row gutter={16}>
            <Col span={6}><Form.Item name="allowText" label="Nhập diễn giải" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="allowFile" label="Tải tệp" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="allowLink" label="Nhập liên kết" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}>
              <Form.Item name="evidenceRequired" label="Bắt buộc minh chứng" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );

  // ================= RENDER CHÍNH (KHÓA TAB) =================
  return (
    <ConfigProvider locale={viVN} form={{ validateMessages: { required: "Vui lòng nhập ${label}" } }}>
    <div className={styles.pageContainer}>
      <Card bordered={false} className={styles.cardContainer}>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab}
          size="large"
          animated={false}
          items={[
            {
              key: '1',
              label: '1. Danh sách kỳ thi',
              children: TabList,
            },
            {
              key: '2',
              label: '2. Thông tin kỳ thi',
              children: TabGeneral,
              disabled: activeTab === "1", // Khóa nếu đang ở Tab 1
            },
            {
              key: '3',
              label: '3. Tiêu chí chấm điểm',
              children: TabCriteria,
              disabled: !currentPeriodId, // Có thể đọc tiêu chí đã lưu mà không buộc sửa cấu hình kỳ công bố
            },
          ]}
        />
      </Card>
      <Modal title={`Chuyển giai đoạn: ${phaseDialog?.record.name || ""}`} open={!!phaseDialog} onCancel={() => setPhaseDialog(null)} footer={null}>
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Text>Giai đoạn hiện tại: {phaseLabels[phaseDialog?.phase]}</Text>
          {phaseDialog?.options.map((option) => <Space key={option.phase}>
            <Popconfirm title={`Chuyển sang ${phaseLabels[option.phase]}?`} description="Hệ thống sẽ kiểm tra lại điều kiện và lưu lịch sử" onConfirm={() => changePhase(option.phase)} okText="Chuyển giai đoạn" cancelText="Hủy" disabled={!option.allowed}>
              <Button disabled={!option.allowed}>{phaseLabels[option.phase]}</Button>
            </Popconfirm>
            <Text type="secondary">{option.message}</Text>
          </Space>)}
        </Space>
      </Modal>
    </div>
    </ConfigProvider>
  );
}
