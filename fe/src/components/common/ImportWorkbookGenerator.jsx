import { useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Table } from "antd";
import { createImportWorkbook, generateImportRows, IMPORT_DEFAULTS } from "../../services/importWorkbook";

/** Tạo bản nháp để Admin sửa/tải lại hoặc đưa vào bước preview đang có */
export default function ImportWorkbookGenerator({ onUse }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const values = Form.useWatch([], form) ?? IMPORT_DEFAULTS;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let rows = []; let validation = "";
  try { rows = generateImportRows(values); } catch (failure) { validation = failure.message; }

  async function generate(download) {
    setBusy(true); setError("");
    try {
      const file = await createImportWorkbook(form.getFieldsValue(true));
      if (download) {
        const url = URL.createObjectURL(file); const link = document.createElement("a");
        link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else { onUse(file); setOpen(false); }
    } catch (failure) { setError(failure.message || "Không thể tạo tệp Excel"); }
    finally { setBusy(false); }
  }

  return <>
    <Button onClick={() => setOpen(true)}>Tạo danh sách Excel</Button>
    <Modal title="Tạo danh sách Excel" open={open} width={850} onCancel={() => !busy && setOpen(false)} footer={<Space wrap><Button disabled={busy} onClick={() => setOpen(false)}>Đóng</Button><Button disabled={!!validation} loading={busy} onClick={() => generate(true)}>Tải bản nháp Excel</Button><Button type="primary" disabled={!!validation} loading={busy} onClick={() => generate(false)}>Dùng bản nháp để xem trước</Button></Space>}>
      <Alert type="info" showIcon title="Bản nháp chưa tạo tài khoản" description="Dùng {n} trong mẫu tên để chèn số thứ tự. Hãy kiểm tra tên và hộp thư thực tế, sau đó xem trước và xác nhận import. Email đúng định dạng chưa xác nhận được người nhận." />
      <Form name="import-workbook-generator" form={form} layout="vertical" initialValues={IMPORT_DEFAULTS}>
        <Space wrap align="start">
          <Form.Item name="count" label="Số lượng"><InputNumber min={1} max={100} /></Form.Item>
          <Form.Item name="start" label="Số bắt đầu"><InputNumber min={0} max={999999999999} /></Form.Item>
          <Form.Item name="digits" label="Số chữ số (giữ 0 đầu)"><InputNumber min={1} max={12} /></Form.Item>
        </Space>
        <Form.Item name="unitPrefix" label="Tiền tố mã đơn vị"><Input maxLength={50} /></Form.Item>
        <Form.Item name="usernamePrefix" label="Tiền tố tên đăng nhập"><Input maxLength={50} /></Form.Item>
        <Form.Item name="unitName" label="Mẫu tên đơn vị"><Input maxLength={180} /></Form.Item>
        <Form.Item name="fullName" label="Mẫu họ tên"><Input maxLength={180} /></Form.Item>
        <Form.Item name="domain" label="Domain email"><Input placeholder="example.com" maxLength={150} /></Form.Item>
        <Form.Item name="unitType" label="Loại đơn vị"><Select options={[{ value: "CONG_AN_QUAN_HUYEN", label: "Công an quận/huyện" }, { value: "PHONG_NGHIEP_VU", label: "Phòng nghiệp vụ" }, { value: "DON_VI_TRUC_THUOC", label: "Đơn vị trực thuộc" }]} /></Form.Item>
      </Form>
      {(validation || error) && <Alert showIcon type="error" title={validation || error} />}
      <Table size="small" rowKey="username" pagination={false} scroll={{ x: 700 }} dataSource={rows.slice(0, 3)} columns={[{ title: "Mã đơn vị", dataIndex: "unitCode" }, { title: "Tên đơn vị", dataIndex: "unitName" }, { title: "Tên đăng nhập", dataIndex: "username" }, { title: "Email", dataIndex: "email" }]} />
      <p>{rows.length} dòng sẽ được sinh; bảng hiển thị tối đa 3 dòng ví dụ</p>
    </Modal>
  </>;
}
