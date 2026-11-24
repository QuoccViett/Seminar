import { useEffect, useRef, useState } from "react";
import { CHANNEL_LABELS, ROLE_LABELS, FIELD_LABELS, displayLabel, deliveryDescription, systemMessage } from "../../services/displayLabels";
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, Upload, message } from "antd";
import { EditOutlined, LockOutlined, UnlockOutlined, KeyOutlined, UploadOutlined } from "@ant-design/icons";
import { userService } from "../../services/userService";
import { unitService } from "../../services/unitService";
import ImportWorkbookGenerator from "../../components/common/ImportWorkbookGenerator";
import PageHeader from "../../components/common/PageHeader";
import styles from "./AdminUsers.module.css";
import { applyFormError } from "../../services/formErrors";

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
  message.error(applyFormError(form, error, "Không thể lưu tài khoản. Vui lòng thử lại."));
}

/** Quản trị tài khoản bằng các API VC04 và hiển thị trạng thái cấp mật khẩu trung thực
 * Import Excel kéo thả gọi preview/confirm thật, lỗi từng dòng được giữ để sửa hoặc tải lại
 */
export default function AdminUsers() {
  const [form] = Form.useForm();
  const role = Form.useWatch("role", form);
  const [users, setUsers] = useState([]);
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
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importKey, setImportKey] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);

  /** Tải tài khoản từ backend theo trang và từ khóa, không lọc cục bộ trên một trang
   * Khi lỗi, giữ bảng cũ cùng cảnh báo cố định và nút thử lại để không nhầm lỗi mạng với danh sách rỗng
   * Chỉ phản hồi của yêu cầu mới nhất được cập nhật bảng khi đổi trang hoặc tìm kiếm liên tiếp
   */
  async function load(nextPage = page, nextSize = pageSize, nextQ = q) {
    const version = ++loadVersion.current;
    setLoading(true); setLoadError("");
    try {
      const result = await userService.getUsers({ page: nextPage, pageSize: nextSize, q: nextQ });
      if (version === loadVersion.current) { setUsers(result.items ?? []); setTotal(result.total ?? 0); }
    } catch (error) {
      if (version === loadVersion.current) setLoadError(error.message || "Không thể tải danh sách tài khoản.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
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
    if (user?.unit && !units.some((unit) => unit.id === user.unit.id)) setUnits((current) => [...current, user.unit]);
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
      Modal.info({ title: `Trạng thái gửi: ${user.username}`, content: <Space orientation="vertical">
        <span>{result.status === "NOT_CONFIGURED" ? "Chưa cấu hình khóa mã hóa để cấp tự động. Cần đặt lại mật khẩu sau khi cấu hình." : result.allRequiredChannelsSent ? "Các kênh được yêu cầu đã tiếp nhận." : "Còn kênh chưa tiếp nhận thông tin đăng nhập."}</span>
        {result.channels.map((item) => <span key={item.channel}>{displayLabel(CHANNEL_LABELS, item.channel, "Kênh khác")}: {deliveryDescription(item)}</span>)}
        <span>Zalo ZNS: Chưa kích hoạt</span>
      </Space>, okText: "Đóng" });
    } catch (error) { message.error(error.message || "Không thể tải trạng thái gửi thông tin đăng nhập."); }
  }

  /** Tải workbook mẫu do backend sinh và chuyển byte response thành thao tác tải xuống của trình duyệt
   * Không dựng mẫu riêng ở FE để giữ nguyên thứ tự cột, tên sheet và định dạng phone do parser chấp nhận
   * Nếu API lỗi thì giữ nguyên modal và báo câu tiếng Việt để người dùng có thể thử lại
   */
  async function downloadImportTemplate() {
    try {
      const response = await userService.downloadImportTemplate();
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "mau-nhap-tai-khoan-unit.xlsx";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error(error.message || "Không thể tải tệp mẫu nhập tài khoản.");
    }
  }

  /** Ghi nhận file người dùng vừa chọn hoặc xóa file hiện tại
   * Mọi thay đổi tệp đều xóa importId và kết quả cũ để confirm không thể dùng preview của workbook trước
   * Việc chọn/kéo thả chỉ đổi state cục bộ, không gọi API tạo tài khoản
   */
  function selectImportFile(file) {
    setImportFile(file);
    setImportKey(file ? `${Date.now()}-${Math.random().toString(36).slice(2)}` : null);
    setImportPreview(null);
    setImportResult(null);
  }

  /** Gửi file XLSX lên parser thật của backend và nhận lỗi theo số dòng/cột
   * Đầu vào là File đang chọn; mỗi File giữ một khóa idempotency để retry mạng trả cùng phiên preview
   * Chỉ lưu response chuẩn hóa trong state phiên hiện tại, không đưa workbook hoặc credential vào local/session storage
   */
  async function previewImport() {
    if (!importFile) return;
    setImportLoading(true);
    try {
      const result = await userService.previewImport(importFile, importKey);
      setImportPreview(result);
      setImportResult(null);
    } catch (error) {
      message.error(error.message || "Không thể xem trước tệp Excel.");
    } finally {
      setImportLoading(false);
    }
  }

  /** Xác nhận đúng ImportSession server đã cấp sau khi mọi dòng preview hợp lệ
   * Đầu ra là số tài khoản/đơn vị cùng delivery theo từng kênh; backend mới là nơi quyết định giao dịch và trạng thái
   * Lỗi theo đường dẫn rows[n].field được gắn lại vào dòng, còn session hết hạn yêu cầu tải lên xem trước lại
   */
  async function confirmImport() {
    if (!importPreview || importPreview.invalidRows !== 0 || importPreview.validRows === 0) return;
    setImportConfirming(true);
    try {
      const result = await userService.confirmImport(importPreview.importId);
      setImportResult(result);
      message.success(`Đã tạo ${result.createdCount} tài khoản đơn vị.`);
      await load(1, pageSize, q);
      setPage(1);
    } catch (error) {
      if (error.fieldErrors?.length) {
        setImportPreview((current) => current ? { ...current, rows: current.rows.map((row) => {
          const rowErrors = error.fieldErrors.flatMap((detail) => {
            const match = /^rows\[(\d+)\]\.(.+)$/.exec(detail.field ?? "");
            return match && Number(match[1]) === row.rowNumber ? detail.messages.map((message) => ({ field: match[2], code: "IMPORT_VALIDATION_FAILED", message })) : [];
          });
          return rowErrors.length ? { ...row, errors: [...row.errors, ...rowErrors] } : row;
        }), invalidRows: Math.max(current.invalidRows, error.fieldErrors.length), validRows: 0 } : current);
      }
      message.error(error.message || "Không thể xác nhận nhập tài khoản.");
    } finally {
      setImportConfirming(false);
    }
  }

  /** Đóng modal và bỏ dữ liệu tạm chỉ tồn tại trong state component
   * ImportSession chưa xác nhận vẫn tự hết hạn phía server sau TTL, nên đóng giao diện không tạo hoặc xóa tài khoản
   */
  function closeImport() {
    setImportOpen(false);
    setImportFile(null);
    setImportKey(null);
    setImportPreview(null);
    setImportResult(null);
  }

  /** Admin xác nhận từng email sau khi kiểm tra người nhận; callback đồng bộ trạng thái kênh mà API trả về
   * Chỉ thao tác xác nhận mới cho phép worker gửi credential qua Email, còn hủy modal không tạo yêu cầu gửi
   */
  function confirmEmail(user, onConfirmed) {
    if (!user.email) { message.error("Tài khoản chưa có địa chỉ email."); return; }
    Modal.confirm({ title: "Xác nhận địa chỉ nhận thông tin đăng nhập", content: `Tôi đã kiểm tra ${user.email} thuộc đúng người nhận ${user.username}. Sau khi xác nhận, hệ thống có thể gửi mật khẩu ban đầu tới địa chỉ này.`, okText: "Đã kiểm tra, cho phép gửi", cancelText: "Hủy", onOk: async () => {
      try { const result = await userService.confirmCredentialEmail(user.id ?? user.userId, user.email); onConfirmed?.(result); message.success("Đã xác nhận email. Trạng thái gửi sẽ được cập nhật sau khi worker xử lý."); }
      catch (error) { message.error(error.message || "Không thể xác nhận email nhận thông tin đăng nhập."); }
    } });
  }

  /** Tải trạng thái mới nhất của một tài khoản theo yêu cầu rõ ràng từ quản trị viên
   * API chỉ đọc delivery đã lưu và cập nhật bảng; không tạo lần gửi mới, phù hợp theo dõi nhiều dòng mà không spam request
   * Lỗi đọc không xóa kết quả trước đó để trạng thái đã nhận vẫn còn hiển thị
   */
  async function refreshImportedStatus(account) {
    try {
      const result = await userService.getCredentialStatus(account.userId);
      setImportResult((current) => current ? { ...current, accounts: current.accounts.map((item) => item.userId === account.userId ? { ...item, credentialStatus: result.status, channels: result.channels } : item) } : current);
    } catch (error) {
      message.error(error.message || "Không thể làm mới trạng thái gửi thông tin đăng nhập.");
    }
  }

  /** Đề nghị backend xếp lại một kênh đang FAILED sau khi quản trị viên chọn retry
   * Đầu vào là tài khoản trong kết quả import và kênh cụ thể; backend xác thực TTL, xác nhận Email hoặc subscription Push
   * Không tự chạy lại provider từ FE; sau khi xếp thành công, đọc lại trạng thái do worker lưu
   */
  async function retryImportedChannel(account, channel) {
    try {
      await userService.retryCredentialDelivery(account.userId, channel);
      await refreshImportedStatus(account);
      message.success(`Đã xếp lại kênh ${displayLabel(CHANNEL_LABELS, channel, "đã chọn")} cho ${account.username}.`);
    } catch (error) {
      message.error(error.message || "Không thể thử lại kênh gửi thông tin đăng nhập.");
    }
  }

  /** Thay trạng thái các delivery sau khi Admin xác nhận địa chỉ nhận Email
   * Đầu vào là userId và response an toàn của API; thay đúng một account trong kết quả, không suy diễn SENT từ thao tác xác nhận
   * Kênh chỉ được xem là đã gửi khi response hoặc lần làm mới sau đó có status SENT
   */
  function applyImportedDeliveryStatus(userId, result) {
    setImportResult((current) => current ? { ...current, accounts: current.accounts.map((item) => item.userId === userId ? { ...item, credentialStatus: result.status, channels: result.channels } : item) } : current);
  }

  const columns = [
    { title: "Tên đăng nhập", dataIndex: "username", key: "username" },
    { title: "Họ và tên", dataIndex: "fullName", key: "fullName" },
    { title: "Quyền", dataIndex: "role", key: "role", render: (value) => displayLabel(ROLE_LABELS, value, "Vai trò chưa xác định") },
    { title: "Đơn vị", key: "unit", render: (_, user) => user.unit?.name ?? "Toàn hệ thống" },
    { title: "Trạng thái", key: "status", render: (_, user) => <Space orientation="vertical"><Tag color={user.isActive ? "green" : "red"}>{user.isActive ? "Đang hoạt động" : "Đã khóa"}</Tag>{user.mustChangePassword && <Tag color="orange">Phải đổi mật khẩu</Tag>}{!user.credentialsSentAt && <Tag>Chưa gửi thông tin đăng nhập</Tag>}</Space> },
    { title: "Hành động", key: "action", render: (_, user) => <Space wrap><Button icon={<EditOutlined />} onClick={() => openForm(user)}>Sửa</Button><Button icon={user.isActive ? <LockOutlined /> : <UnlockOutlined />} onClick={() => toggleStatus(user)}>{user.isActive ? "Khóa" : "Mở"}</Button><Button icon={<KeyOutlined />} onClick={() => resetPassword(user)}>Đặt lại mật khẩu</Button><Button onClick={() => showDeliveryStatus(user)}>Trạng thái gửi</Button><Button disabled={!user.email || !user.mustChangePassword} onClick={() => confirmEmail(user)}>Xác nhận email</Button></Space> },
  ];

  return <div className={styles.pageContainer}>
    {/* Tìm kiếm gọi q trên backend, Import kéo thả chỉ ghi sau bước xem trước và xác nhận */}
    <div className={styles.toolbar}><div className={styles.toolbarHeader}><PageHeader title="Quản lý tài khoản" searchPlaceholder="Tìm tên đăng nhập, họ tên hoặc email" onSearch={search} onAdd={() => openForm()} addButtonText="Thêm tài khoản" /></div><Button className={styles.importButton} icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>Import Excel</Button></div>
    {loadError && <Alert type="error" title={loadError} showIcon action={<Button onClick={() => load()}>Thử tải lại tài khoản</Button>} />}
    <div className={styles.tableContainer}><Table columns={columns} dataSource={users} rowKey="id" loading={loading} locale={{ emptyText: loadError ? "Chưa tải được danh sách tài khoản" : "Không có tài khoản phù hợp" }} pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, size) => { setPage(p); setPageSize(size); load(p, size, q); }, showTotal: (count) => `${count} tài khoản` }} /></div>
    {/* Form không gửi isActive hoặc mật khẩu cũ; backend quyết định allowlist cuối cùng */}
    <Modal title={editing ? "Sửa tài khoản" : "Thêm tài khoản"} open={open} confirmLoading={saving} okText="Lưu" cancelText="Hủy" onOk={() => form.submit()} onCancel={() => setOpen(false)}>
      <Form name="admin-user-form" form={form} layout="vertical" onFinish={save}>
        {!editing && <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, message: "Vui lòng nhập tên đăng nhập." }]}><Input maxLength={64} /></Form.Item>}
        <Form.Item name="fullName" label="Họ và tên" rules={[{ required: true, message: "Vui lòng nhập họ và tên." }]}><Input /></Form.Item>
        <Form.Item name="email" label="Email" rules={[{ type: "email", message: "Email không hợp lệ." }]}><Input /></Form.Item>
        <Form.Item name="phone" label="Số điện thoại" rules={[{ pattern: /^\+?[0-9]{9,15}$/, message: "Số điện thoại phải có 9 đến 15 chữ số." }]}><Input /></Form.Item>
        <Form.Item name="role" label="Vai trò" rules={[{ required: true, message: "Vui lòng chọn vai trò." }]}><Select options={[{ value: "ADMIN", label: "Quản trị viên" }, { value: "UNIT", label: "Đơn vị tự chấm" }]} /></Form.Item>
        {role === "UNIT" && <Form.Item name="unitId" label="Đơn vị" rules={[{ required: true, message: "Vui lòng chọn đơn vị." }]}><Select showSearch filterOption={false} onSearch={loadUnits} options={units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))} placeholder="Tìm và chọn đơn vị" /></Form.Item>}
      </Form>
    </Modal>
    {/* Khu vực này chỉ chọn file và gọi backend preview; sự kiện thả không tự ghi tài khoản */}
    <Modal title="Nhập tài khoản đơn vị từ Excel" open={importOpen} width={1000} confirmLoading={importConfirming} okText="Xác nhận tạo tài khoản" cancelText="Đóng" onOk={confirmImport} onCancel={closeImport} okButtonProps={{ disabled: !importPreview || importPreview.validRows === 0 || importPreview.invalidRows > 0 || !!importResult }}>
      <Space orientation="vertical" style={{ width: "100%" }} size="middle">
        <Space wrap><ImportWorkbookGenerator onUse={selectImportFile} /><Button onClick={downloadImportTemplate}>Tải tệp mẫu</Button><span>Tệp XLSX tối đa 5 MiB và 100 dòng; email bắt buộc để gửi thông tin đăng nhập</span></Space>
        <Upload.Dragger accept=".xlsx" maxCount={1} fileList={importFile ? [{ uid: "import-file", name: importFile.name, status: "done" }] : []} beforeUpload={(file) => { selectImportFile(file); return false; }} onRemove={() => { selectImportFile(null); return true; }} showUploadList>
          <p><UploadOutlined /></p><p>Kéo thả tệp Excel vào đây hoặc bấm để chọn</p><p>Chọn tệp không tạo tài khoản; cần xem trước rồi xác nhận</p>
        </Upload.Dragger>
        {importFile && <Space wrap><Button type="primary" loading={importLoading} onClick={previewImport}>Xem trước và kiểm tra</Button><Button onClick={() => selectImportFile(null)}>Xóa tệp</Button></Space>}
        {importPreview && <>
          <div>{`Phiên xem trước đến ${new Date(importPreview.expiresAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}: ${importPreview.totalRows} dòng, ${importPreview.validRows} hợp lệ, ${importPreview.invalidRows} có lỗi`}</div>
          <Table size="small" rowKey="rowNumber" dataSource={importPreview.rows} pagination={{ pageSize: 10 }} scroll={{ x: 900 }} columns={[
            { title: "Dòng", dataIndex: "rowNumber", width: 70 }, { title: "Mã đơn vị", dataIndex: "unitCode" }, { title: "Tên đơn vị", dataIndex: "unitName" }, { title: "Tên đăng nhập", dataIndex: "username" }, { title: "Họ và tên", dataIndex: "fullName" }, { title: "Email", dataIndex: "email" }, { title: "Điện thoại", dataIndex: "phone" },
            { title: "Lỗi", key: "errors", render: (_, row) => row.errors.map((item, index) => <div key={`${item.code}-${index}`}><Tag color="red">Cần sửa</Tag>{displayLabel(FIELD_LABELS, item.field, "Dữ liệu dòng")}: {systemMessage(item.message, "Dữ liệu không hợp lệ, vui lòng kiểm tra lại")}</div>) },
          ]} />
        </>}
        {importResult && <>
          <div>{`Đã tạo ${importResult.createdCount} tài khoản và ${importResult.unitsCreated} đơn vị mới. Tiến độ: ${importResult.accounts.length}/${importPreview?.totalRows ?? importResult.accounts.length} tài khoản đã xử lý.`}</div>
          <Table size="small" rowKey="userId" dataSource={importResult.accounts} pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} columns={[
            { title: "Dòng", dataIndex: "rowNumber" }, { title: "Đơn vị", dataIndex: "unitCode" }, { title: "Tên đăng nhập", dataIndex: "username" }, { title: "Thông tin đăng nhập", dataIndex: "credentialStatus", render: (status) => status === "QUEUED" ? "Đã xếp hàng" : "Chưa cấu hình" },
            { title: "Email", key: "email", render: (_, row) => { const delivery = row.channels.find((item) => item.channel === "EMAIL"); return <Space direction="vertical"><span>{deliveryDescription(delivery)}</span>{delivery?.errorCode === "EMAIL_UNCONFIRMED" && <Button size="small" onClick={() => confirmEmail(row, (result) => applyImportedDeliveryStatus(row.userId, result))}>Xác nhận email đã kiểm tra</Button>}{delivery?.status === "FAILED" && <Button size="small" onClick={() => retryImportedChannel(row, "EMAIL")}>Thử lại Email</Button>}</Space>; } },
            { title: "Web Push", key: "push", render: (_, row) => { const delivery = row.channels.find((item) => item.channel === "WEB_PUSH"); return <Space direction="vertical"><span>{deliveryDescription(delivery)}</span>{delivery?.status === "FAILED" && <Button size="small" onClick={() => retryImportedChannel(row, "WEB_PUSH")}>Thử lại Web Push</Button>}</Space>; } }, { title: "Zalo ZNS", render: () => "Chưa kích hoạt" }, { title: "Tiến độ", render: (_, row) => <Button size="small" onClick={() => refreshImportedStatus(row)}>Cập nhật trạng thái</Button> },
          ]} />
        </>}
      </Space>
    </Modal>
  </div>;
}
