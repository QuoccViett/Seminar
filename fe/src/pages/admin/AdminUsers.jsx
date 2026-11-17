import { useEffect, useState } from "react";
import { Button, Form, Input, Modal, Select, Space, Table, Tag, Upload, message } from "antd";
import { EditOutlined, LockOutlined, UnlockOutlined, KeyOutlined, UploadOutlined } from "@ant-design/icons";
import { userService } from "../../services/userService";
import { unitService } from "../../services/unitService";
import PageHeader from "../../components/common/PageHeader";
import styles from "./AdminUsers.module.css";

/** Hiển thị mật khẩu tạm đúng một lần và nêu rõ trạng thái chờ worker của VC06
 * Giá trị chỉ lấy từ phản hồi vừa tạo hoặc đặt lại, không được lưu vào state danh sách
 */
function showTemporaryPassword(result) {
  Modal.info({
    title: "Thông tin đăng nhập tạm",
    content: <Space orientation="vertical"><span>Mật khẩu tạm của tài khoản này:</span><Input.Password readOnly value={result.temporaryPassword} /><span>Việc gửi qua Email/Web Push phụ thuộc cấu hình và điều kiện nhận. Xem “Trạng thái gửi” để kiểm tra, không coi việc tạo tài khoản là đã gửi.</span><span>Tài khoản phải đổi mật khẩu khi đăng nhập lần đầu.</span></Space>,
    okText: "Đã ghi nhận",
  });
}

/** Gắn lỗi từng trường từ backend lên form và dùng thông điệp tiếng Việt đã chuẩn hóa
 * Trường không có lỗi riêng vẫn giữ dữ liệu để quản trị viên sửa mà không nhập lại
 */
function showFormError(error, form) {
  const fields = error.fieldErrors?.filter((item) => item.field && Array.isArray(item.messages)) ?? [];
  if (fields.length) form.setFields(fields.map((item) => ({ name: item.field, errors: item.messages })));
  message.error(error.message || "Không thể lưu tài khoản. Vui lòng thử lại.");
}

/** Quản trị tài khoản bằng các API VC04 và hiển thị trạng thái cấp mật khẩu trung thực
 * Import Excel kéo thả được giữ chỗ cho VC07, không gọi endpoint chưa tồn tại
 */
export default function AdminUsers() {
  const [form] = Form.useForm();
  const role = Form.useWatch("role", form);
  const [users, setUsers] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  /** Tải tài khoản từ backend theo trang và từ khóa, không lọc cục bộ trên một trang
   * Khi lỗi, giữ nguyên bảng cũ và báo người dùng để họ có thể thử lại
   */
  async function load(nextPage = page, nextSize = pageSize, nextQ = q) {
    setLoading(true);
    try {
      const result = await userService.getUsers({ page: nextPage, pageSize: nextSize, q: nextQ });
      setUsers(result.items ?? []);
      setTotal(result.total ?? 0);
    } catch (error) {
      message.error(error.message || "Không thể tải danh sách tài khoản.");
    } finally {
      setLoading(false);
    }
  }

  /** Tải các đơn vị hoạt động để form UNIT chỉ chọn được đơn vị đủ điều kiện
   * Giới hạn 100 phù hợp quy mô demo; ô tìm kiếm vẫn gửi q lên backend khi gõ
   */
  async function loadUnits(search = "") {
    try {
      const result = await unitService.getUnits({ page: 1, pageSize: 100, isActive: true, q: search });
      setUnits(result.items ?? []);
    } catch (error) {
      message.error(error.message || "Không thể tải đơn vị cho tài khoản.");
    }
  }

  useEffect(() => {
    // Tải trang đầu và danh sách đơn vị khi vào màn quản trị
    load(1, 20, "");
    loadUnits();
  }, []);

  /** Tìm tài khoản trên backend, bắt đầu lại ở trang đầu để kết quả không bị bỏ sót
   * q trống được backend hiểu là bỏ điều kiện tìm kiếm
   */
  function search(value) {
    setQ(value);
    setPage(1);
    load(1, pageSize, value);
  }

  /** Mở form tạo hoặc sửa và nạp duy nhất các trường cho phép theo API contract
   * Username không được sửa; role ADMIN không dùng unitId
   */
  function openForm(user = null) {
    setEditing(user);
    form.resetFields();
    form.setFieldsValue(user ? { fullName: user.fullName, email: user.email, phone: user.phone, role: user.role, unitId: user.unitId } : { role: "UNIT" });
    setOpen(true);
  }

  /** Lưu form qua POST hoặc PATCH, sau đó tải lại bảng và hiển thị mật khẩu tạm khi cấp mới
   * Nếu backend từ chối thì giữ modal mở và gắn lỗi trường lên form
   */
  async function save(values) {
    setSaving(true);
    try {
      const payload = editing
        ? {
            fullName: values.fullName,
            email: values.email || null,
            phone: values.phone || null,
            ...(values.role !== editing.role ? { role: values.role } : {}),
            ...(values.role !== editing.role || values.unitId !== editing.unitId ? { unitId: values.role === "ADMIN" ? null : values.unitId } : {}),
          }
        : { ...values, unitId: values.role === "ADMIN" ? null : values.unitId, email: values.email || null, phone: values.phone || null };
      const result = editing ? await userService.updateUser(editing.id, payload) : await userService.createUser(payload);
      message.success(editing ? "Đã cập nhật tài khoản." : "Đã tạo tài khoản.");
      setOpen(false);
      await load(editing ? page : 1, pageSize, q);
      if (!editing) {
        setPage(1);
        showTemporaryPassword(result);
      }
    } catch (error) {
      showFormError(error, form);
    } finally {
      setSaving(false);
    }
  }

  /** Xác nhận thay đổi trạng thái trước khi gọi route thu hồi phiên của backend
   * Lỗi tự khóa hoặc ADMIN cuối được hiển thị nguyên văn tiếng Việt từ API
   */
  function toggleStatus(user) {
    Modal.confirm({
      title: user.isActive ? "Khóa tài khoản" : "Mở tài khoản",
      content: `Xác nhận ${user.isActive ? "khóa" : "mở"} tài khoản ${user.username}?`,
      okText: "Xác nhận", cancelText: "Hủy", okButtonProps: { danger: user.isActive },
      onOk: async () => {
        try {
          await userService.toggleUserStatus(user.id, !user.isActive);
          message.success("Đã cập nhật trạng thái tài khoản.");
          await load();
        } catch (error) {
          message.error(error.message || "Không thể đổi trạng thái tài khoản.");
        }
      },
    });
  }

  /** Xác nhận đặt lại mật khẩu vì thao tác vô hiệu hóa mọi phiên đang dùng
   * Chỉ phản hồi thành công mới hiển thị mật khẩu tạm một lần và trạng thái chưa gửi
   */
  function resetPassword(user) {
    Modal.confirm({
      title: "Đặt lại mật khẩu",
      content: `Đặt lại mật khẩu cho ${user.username} và thu hồi các phiên hiện tại?`,
      okText: "Đặt lại", cancelText: "Hủy",
      onOk: async () => {
        try {
          const result = await userService.resetPassword(user.id);
          showTemporaryPassword(result);
          await load();
        } catch (error) {
          message.error(error.message || "Không thể đặt lại mật khẩu.");
        }
      },
    });
  }

  /** Xem kết quả từng kênh từ backend, bao gồm chờ đăng ký Push và ZNS chưa kích hoạt */
  async function showDeliveryStatus(user) {
    try {
      const result = await userService.getCredentialStatus(user.id);
      const labels = { SENT: "Đã được kênh tiếp nhận", PENDING: "Đang chờ", FAILED: "Gửi thất bại", SKIPPED: "Đã bỏ qua" };
      Modal.info({ title: `Trạng thái gửi: ${user.username}`, content: <Space orientation="vertical">
        <span>{result.status === "NOT_CONFIGURED" ? "Chưa cấu hình khóa mã hóa để cấp tự động. Cần đặt lại mật khẩu sau khi cấu hình." : result.allRequiredChannelsSent ? "Các kênh được yêu cầu đã tiếp nhận." : "Còn kênh chưa tiếp nhận thông tin đăng nhập."}</span>
        {result.channels.map((item) => <span key={item.channel}>{item.channel}: {labels[item.status] ?? item.status}{item.errorCode ? ` (${item.errorCode})` : ""}</span>)}
        <span>Zalo ZNS: Chưa kích hoạt</span>
      </Space>, okText: "Đóng" });
    } catch (error) { message.error(error.message || "Không thể tải trạng thái gửi thông tin đăng nhập."); }
  }

  /** Admin chỉ mở khóa gửi Email sau khi tự kiểm tra đúng địa chỉ người nhận trên modal */
  function confirmEmail(user) {
    if (!user.email) { message.error("Tài khoản chưa có địa chỉ email."); return; }
    Modal.confirm({ title: "Xác nhận địa chỉ nhận thông tin đăng nhập", content: `Tôi đã kiểm tra ${user.email} thuộc đúng người nhận ${user.username}. Sau khi xác nhận, hệ thống có thể gửi mật khẩu ban đầu tới địa chỉ này.`, okText: "Đã kiểm tra, cho phép gửi", cancelText: "Hủy", onOk: async () => {
      try { await userService.confirmCredentialEmail(user.id, user.email); message.success("Đã xác nhận email. Trạng thái gửi sẽ được cập nhật sau khi worker xử lý."); }
      catch (error) { message.error(error.message || "Không thể xác nhận email nhận thông tin đăng nhập."); }
    } });
  }

  const columns = [
    { title: "Tên đăng nhập", dataIndex: "username", key: "username" },
    { title: "Họ và tên", dataIndex: "fullName", key: "fullName" },
    { title: "Quyền", dataIndex: "role", key: "role" },
    { title: "Đơn vị", key: "unit", render: (_, user) => user.unit?.name ?? "Toàn hệ thống" },
    { title: "Trạng thái", key: "status", render: (_, user) => <Space orientation="vertical"><Tag color={user.isActive ? "green" : "red"}>{user.isActive ? "Đang hoạt động" : "Đã khóa"}</Tag>{user.mustChangePassword && <Tag color="orange">Phải đổi mật khẩu</Tag>}{!user.credentialsSentAt && <Tag>Chưa gửi thông tin đăng nhập</Tag>}</Space> },
    { title: "Hành động", key: "action", render: (_, user) => <Space wrap><Button icon={<EditOutlined />} onClick={() => openForm(user)}>Sửa</Button><Button icon={user.isActive ? <LockOutlined /> : <UnlockOutlined />} onClick={() => toggleStatus(user)}>{user.isActive ? "Khóa" : "Mở"}</Button><Button icon={<KeyOutlined />} onClick={() => resetPassword(user)}>Đặt lại mật khẩu</Button><Button onClick={() => showDeliveryStatus(user)}>Trạng thái gửi</Button><Button disabled={!user.email || !user.mustChangePassword} onClick={() => confirmEmail(user)}>Xác nhận email</Button></Space> },
  ];

  return <div className={styles.pageContainer}>
    {/* Thanh tìm kiếm dùng q trên backend và giữ chỗ Import kéo thả cho VC07 */}
    <div className={styles.toolbar}><PageHeader title="Quản lý tài khoản" searchPlaceholder="Tìm tên đăng nhập, họ tên hoặc email" onSearch={search} onAdd={() => openForm()} addButtonText="Thêm tài khoản" /><Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>Import Excel</Button></div>
    <div className={styles.tableContainer}><Table columns={columns} dataSource={users} rowKey="id" loading={loading} locale={{ emptyText: "Không có tài khoản phù hợp" }} pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, size) => { setPage(p); setPageSize(size); load(p, size, q); }, showTotal: (count) => `${count} tài khoản` }} /></div>
    {/* Form không gửi isActive hoặc mật khẩu cũ; backend quyết định allowlist cuối cùng */}
    <Modal title={editing ? "Sửa tài khoản" : "Thêm tài khoản"} open={open} confirmLoading={saving} okText="Lưu" cancelText="Hủy" onOk={() => form.submit()} onCancel={() => setOpen(false)}>
      <Form form={form} layout="vertical" onFinish={save}>
        {!editing && <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, message: "Vui lòng nhập tên đăng nhập." }]}><Input maxLength={64} /></Form.Item>}
        <Form.Item name="fullName" label="Họ và tên" rules={[{ required: true, message: "Vui lòng nhập họ và tên." }]}><Input /></Form.Item>
        <Form.Item name="email" label="Email" rules={[{ type: "email", message: "Email không hợp lệ." }]}><Input /></Form.Item>
        <Form.Item name="phone" label="Số điện thoại" rules={[{ pattern: /^\+?[0-9]{9,15}$/, message: "Số điện thoại phải có 9 đến 15 chữ số." }]}><Input /></Form.Item>
        <Form.Item name="role" label="Vai trò" rules={[{ required: true, message: "Vui lòng chọn vai trò." }]}><Select options={[{ value: "ADMIN", label: "Quản trị viên" }, { value: "UNIT", label: "Đơn vị tự chấm" }]} /></Form.Item>
        {role === "UNIT" && <Form.Item name="unitId" label="Đơn vị" rules={[{ required: true, message: "Vui lòng chọn đơn vị." }]}><Select showSearch filterOption={false} onSearch={loadUnits} options={units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} placeholder="Tìm và chọn đơn vị" /></Form.Item>}
      </Form>
    </Modal>
    {/* Giữ điểm vào kéo thả theo yêu cầu, báo rõ backend Import sẽ triển khai ở VC07 */}
    <Modal title="Import Excel kéo thả" open={importOpen} footer={null} onCancel={() => setImportOpen(false)}>
      <Upload.Dragger disabled showUploadList={false}><p>Kéo thả tệp Excel vào đây</p><p>Chức năng nhập hàng loạt chưa khả dụng trong VC04; sẽ triển khai cùng backend ở VC07.</p></Upload.Dragger>
    </Modal>
  </div>;
}
