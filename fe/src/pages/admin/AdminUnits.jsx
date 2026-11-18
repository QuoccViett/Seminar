import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Switch, Table, Tag, message } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { unitService } from "../../services/unitService";
import PageHeader from "../../components/common/PageHeader";
import styles from "./AdminUnits.module.css";
import { applyFormError } from "../../services/formErrors";

const UNIT_TYPES = [
  { value: "CONG_AN_QUAN_HUYEN", label: "Công an quận/huyện" },
  { value: "PHONG_NGHIEP_VU", label: "Phòng nghiệp vụ" },
  { value: "DON_VI_TRUC_THUOC", label: "Đơn vị trực thuộc" },
];

/** Hiển thị lỗi trường từ backend trên form để người quản trị sửa đúng đầu vào
 * Lỗi không có trường được báo bằng thông điệp tiếng Việt đã chuẩn hóa ở apiClient
 */
function showFormError(error, form) {
  message.error(applyFormError(form, error, "Không thể lưu đơn vị. Vui lòng thử lại."));
}

/** Quản trị danh sách đơn vị bằng API thật với tìm kiếm, phân trang và form tạo/sửa
 * Trạng thái khóa chỉ đổi qua PATCH, hồ sơ cũ vẫn được backend giữ nguyên
 */
export default function AdminUnits() {
  const [form] = Form.useForm();
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const loadVersion = useRef(0);
  const [saving, setSaving] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  /** Tải trang đơn vị theo bộ lọc đang chọn và giữ trạng thái lỗi rõ ràng
   * Kết quả rỗng được Table hiển thị; các lệnh gọi đều đi qua backend thật
   * Lỗi có cảnh báo và nút thử lại cố định, phiên bản yêu cầu bỏ phản hồi cũ khi đổi bộ lọc nhanh
   */
  async function load(nextPage = page, nextSize = pageSize, nextQ = q) {
    const version = ++loadVersion.current;
    setLoading(true); setLoadError("");
    try {
      const result = await unitService.getUnits({ page: nextPage, pageSize: nextSize, q: nextQ });
      if (version === loadVersion.current) { setUnits(result.items ?? []); setTotal(result.total ?? 0); }
    } catch (error) {
      if (version === loadVersion.current) setLoadError(error.message || "Không thể tải danh sách đơn vị.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    // Tải trang đầu khi mở màn, thay đổi bộ lọc sẽ gọi load từ sự kiện tương ứng
    load(1, 20, "");
  }, []);

  /** Mở form với dữ liệu hiện có hoặc form trống, tránh giữ dữ liệu bản ghi trước
   * Khi sửa, chỉ các trường trong contract được nạp lên form
   */
  function openForm(unit = null) {
    setEditing(unit);
    form.resetFields();
    form.setFieldsValue(unit ? { code: unit.code, name: unit.name, unitType: unit.unitType, sortOrder: unit.sortOrder, isActive: unit.isActive } : { sortOrder: 0, isActive: true });
    setOpen(true);
  }

  /** Gửi form tạo hoặc sửa, báo lỗi từng trường và chỉ đóng sau khi backend xác nhận
   * Không tự suy đoán kết quả thành công từ dữ liệu đang hiển thị trên màn
   */
  async function save(values) {
    setSaving(true);
    try {
      if (editing) await unitService.updateUnit(editing.id, values);
      else await unitService.createUnit(values);
      message.success(editing ? "Đã cập nhật đơn vị." : "Đã tạo đơn vị.");
      setOpen(false);
      await load(editing ? page : 1, pageSize, q);
      if (!editing) setPage(1);
    } catch (error) {
      showFormError(error, form);
    } finally {
      setSaving(false);
    }
  }

  /** Tìm mã hoặc tên đơn vị từ backend và quay về trang đầu để không bỏ sót kết quả
   * Chuỗi trống bỏ lọc theo cùng contract với service
   */
  function search(value) {
    setQ(value);
    setPage(1);
    load(1, pageSize, value);
  }

  const columns = [
    { title: "Mã đơn vị", dataIndex: "code", key: "code" },
    { title: "Tên đơn vị", dataIndex: "name", key: "name" },
    { title: "Loại", dataIndex: "unitType", key: "unitType", render: (value) => UNIT_TYPES.find((item) => item.value === value)?.label ?? "Chưa phân loại" },
    { title: "Trạng thái", dataIndex: "isActive", key: "isActive", render: (value) => <Tag color={value ? "green" : "red"}>{value ? "Đang hoạt động" : "Đã khóa"}</Tag> },
    { title: "Hành động", key: "action", render: (_, unit) => <Button icon={<EditOutlined />} onClick={() => openForm(unit)}>Sửa</Button> },
  ];

  return <div className={styles.pageContainer}>
    {/* Thanh tìm kiếm và nút tạo điều khiển dữ liệu từ API */}
    <div className={styles.toolbar}><PageHeader title="Quản lý đơn vị" searchPlaceholder="Tìm mã hoặc tên đơn vị" onSearch={search} onAdd={() => openForm()} addButtonText="Thêm đơn vị" /></div>
    {loadError && <Alert type="error" title={loadError} showIcon action={<Button onClick={() => load()}>Thử tải lại đơn vị</Button>} />}
    <div className={styles.tableContainer}>
      <Table columns={columns} dataSource={units} rowKey="id" loading={loading} locale={{ emptyText: loadError ? "Chưa tải được danh sách đơn vị" : "Không có đơn vị phù hợp" }} pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, size) => { setPage(p); setPageSize(size); load(p, size, q); }, showTotal: (count) => `${count} đơn vị` }} />
    </div>
    {/* Cùng một form tạo và sửa để giữ quy tắc kiểm tra dữ liệu nhất quán */}
    <Modal title={editing ? "Sửa đơn vị" : "Thêm đơn vị"} open={open} confirmLoading={saving} okText="Lưu" cancelText="Hủy" onOk={() => form.submit()} onCancel={() => setOpen(false)}>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="code" label="Mã đơn vị" rules={[{ required: true, message: "Vui lòng nhập mã đơn vị." }]}><Input maxLength={64} /></Form.Item>
        <Form.Item name="name" label="Tên đơn vị" rules={[{ required: true, message: "Vui lòng nhập tên đơn vị." }]}><Input maxLength={255} /></Form.Item>
        <Form.Item name="unitType" label="Loại đơn vị"><Select allowClear options={UNIT_TYPES} placeholder="Chọn loại đơn vị" /></Form.Item>
        <Form.Item name="sortOrder" label="Thứ tự" rules={[{ required: true, message: "Vui lòng nhập thứ tự." }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="isActive" label="Hoạt động" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
