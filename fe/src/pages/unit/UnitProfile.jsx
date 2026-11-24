import { useEffect, useState } from "react";
import { Alert, Button, Card, Descriptions, Form, Input, Space, Table, Tag, Typography, message } from "antd";
import { useAuth } from "../../contexts/AuthContext";
import { authService } from "../../services/authService";
import { setSession } from "../../services/session";
import { unitService } from "../../services/unitService";
import { userService } from "../../services/userService";

const UNIT_TYPE_LABELS = {
  CONG_AN_QUAN_HUYEN: "Công an quận/huyện",
  PHONG_NGHIEP_VU: "Phòng nghiệp vụ",
  DON_VI_TRUC_THUOC: "Đơn vị trực thuộc",
};

/** Hồ sơ tài khoản UNIT và đơn vị lấy từ API có kiểm tra quyền theo phiên */
export default function UnitProfile() {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [profile, setProfile] = useState(null);
  const [unit, setUnit] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const current = await userService.getUser(user.id);
        const [unitInfo, unitAccounts] = current.unitId
          ? await Promise.all([unitService.getUnit(current.unitId), unitService.getUnitUsers(current.unitId)])
          : [null, { items: [] }];
        if (!active) return;
        setProfile(current);
        setUnit(unitInfo);
        setMembers(unitAccounts.items ?? []);
        form.setFieldsValue({ username: current.username, fullName: current.fullName, email: current.email ?? "", phone: current.phone ?? "" });
      } catch (failure) {
        if (active) setError(failure.message || "Không thể tải hồ sơ cá nhân.");
      } finally {
        if (active) setLoading(false);
      }
    }
    if (user?.id) void load();
    return () => { active = false; };
  }, [user?.id, form]);

  async function save(values) {
    if (!profile) return;
    setSaving(true);
    try {
      const updated = await userService.updateUser(profile.id, {
        fullName: values.fullName.trim(),
        email: values.email.trim() || null,
        phone: values.phone.trim() || null,
      });
      const current = await authService.getMe();
      setSession({ user: current });
      setProfile((previous) => ({ ...previous, ...updated }));
      message.success("Đã cập nhật hồ sơ cá nhân.");
    } catch (failure) {
      if (Array.isArray(failure.fieldErrors)) form.setFields(failure.fieldErrors.map((item) => ({ name: item.field, errors: item.messages ?? [] })));
      message.error(failure.message || "Không thể cập nhật hồ sơ cá nhân.");
    } finally {
      setSaving(false);
    }
  }

  const memberColumns = [
    { title: "Tên đăng nhập", dataIndex: "username" },
    { title: "Họ và tên", dataIndex: "fullName" },
    { title: "Email", dataIndex: "email", render: (value) => value || "—" },
    { title: "Số điện thoại", dataIndex: "phone", render: (value) => value || "—" },
    { title: "Trạng thái", dataIndex: "isActive", render: (active) => <Tag color={active ? "green" : "default"}>{active ? "Đang hoạt động" : "Đã khóa"}</Tag> },
  ];

  return <Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <div>
      <Typography.Title level={2} style={{ margin: 0 }}>Hồ sơ cá nhân</Typography.Title>
      <Typography.Text type="secondary">Thông tin tài khoản và đơn vị đang liên kết với phiên đăng nhập.</Typography.Text>
    </div>
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => window.location.reload()}>Tải lại</Button>} />}
    <Card title="Thông tin tài khoản" loading={loading}>
      {profile && <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item label="Tên đăng nhập" name="username"><Input disabled /></Form.Item>
        <Form.Item label="Họ và tên" name="fullName" rules={[{ required: true, whitespace: true, message: "Vui lòng nhập họ và tên." }, { max: 200, message: "Họ và tên tối đa 200 ký tự." }]}><Input maxLength={200} /></Form.Item>
        <Form.Item label="Email" name="email" rules={[{ type: "email", message: "Email chưa đúng định dạng." }, { max: 254, message: "Email tối đa 254 ký tự." }]}><Input maxLength={254} /></Form.Item>
        <Form.Item label="Số điện thoại" name="phone" rules={[{ pattern: /^\+?[0-9]{9,15}$/, message: "Số điện thoại cần 9–15 chữ số, có thể bắt đầu bằng dấu +." }]}><Input maxLength={20} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>Lưu thay đổi</Button>
      </Form>}
    </Card>
    <Card title="Thông tin đơn vị" loading={loading}>
      {unit ? <Descriptions column={{ xs: 1, sm: 2 }} bordered>
        <Descriptions.Item label="Mã đơn vị">{unit.code}</Descriptions.Item>
        <Descriptions.Item label="Tên đơn vị">{unit.name}</Descriptions.Item>
        <Descriptions.Item label="Loại đơn vị">{UNIT_TYPE_LABELS[unit.unitType] ?? "Chưa phân loại"}</Descriptions.Item>
        <Descriptions.Item label="Trạng thái"><Tag color={unit.isActive ? "green" : "default"}>{unit.isActive ? "Đang hoạt động" : "Đã khóa"}</Tag></Descriptions.Item>
      </Descriptions> : <Typography.Text type="secondary">Tài khoản chưa được gắn với đơn vị.</Typography.Text>}
    </Card>
    <Card title={`Tài khoản thuộc đơn vị${members.length ? ` (${members.length})` : ""}`} loading={loading}>
      <Table rowKey="id" dataSource={members} columns={memberColumns} pagination={false} scroll={{ x: 750 }} locale={{ emptyText: "Chưa có tài khoản thuộc đơn vị." }} />
    </Card>
  </Space>;
}
