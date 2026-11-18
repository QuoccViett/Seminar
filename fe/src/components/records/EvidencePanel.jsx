import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Popconfirm, Progress, Space, Tag, Typography, Upload } from "antd";
import { cancelEvidenceUpload, confirmEvidences, deleteEvidence, readEvidenceBlob, requestEvidenceUploads, uploadEvidenceBytes } from "../../services/evidenceService";

/** Giao diện minh chứng dùng chung UNIT và ADMIN, quyền thao tác lấy hoàn toàn từ server
 * Tệp xử lý tuần tự để tiến độ/lỗi độc lập và không tạo mười bản sao buffer cùng lúc
 * onBusyChange khóa nộp ở cha trong lúc upload/confirm, backend vẫn kiểm lại nếu deadline vừa qua
 */
export default function EvidencePanel({ evaluationId, row, onReload = () => {}, disabled = false, onBusyChange = () => {} }) {
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState(null);
  const active = useRef(true);
  const working = useRef(false);
  const objectUrls = useRef(new Set());
  const canEdit = row.canEditSelf && !disabled && !busy;

  /** Thu hồi mọi object URL khi rời trang, kết quả request đến muộn không được giữ blob trong bộ nhớ */
  useEffect(() => {
    active.current = true;
    const urls = objectUrls.current;
    return () => { active.current = false; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  }, []);

  /** Chặn click lặp trước render và thông báo cha khóa nộp, chỉ nhận một công việc tại một thời điểm */
  function begin() {
    if (working.current) return false;
    working.current = true; setBusy(true); onBusyChange(true); setError("");
    return true;
  }

  /** Mở khóa sau mọi nhánh, tải lại snapshot quyền từ BE sau cả lỗi để không giữ quyền đã quá hạn */
  function finish() {
    working.current = false;
    if (active.current) { setBusy(false); onBusyChange(false); onReload(); }
  }

  /** Cập nhật một dòng tiến độ theo khóa cục bộ, không dùng tên vì nhiều tệp có thể trùng tên */
  function jobState(key, patch) { if (active.current) setJobs((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item)); }

  /** Xin URL, truyền bytes và xác nhận từng file, chỉ báo hoàn thành sau Evidence đã commit
   * File lỗi được hủy reservation độc lập, hủy lỗi do mạng để backend cleanup sau TTL
   * Mỗi lần xin một file nên chọn nhiều hơn mười vẫn được xử lý theo kết quả quota thực tế
   */
  async function upload(files) {
    if (!row.canEditSelf || disabled || !begin()) return;
    const selected = files.map((file) => ({ file, key: crypto.randomUUID(), name: file.name, percent: 0, text: "Đang chờ", failed: false }));
    setJobs(selected);
    try {
      for (const item of selected) {
        let uploadId;
        try {
          jobState(item.key, { text: "Đang xin quyền tải" });
          const result = (await requestEvidenceUploads(evaluationId, [{ criterionId: row.criterionId, fileName: item.file.name, mimeType: item.file.type || mimeFromName(item.file.name), sizeBytes: item.file.size }])).results[0];
          if (!result.ok) throw new Error(result.error.message);
          const grant = result.data; uploadId = grant.uploadId;
          jobState(item.key, { text: "Đang tải" });
          await uploadEvidenceBytes(grant, item.file, (percent) => jobState(item.key, { percent }));
          jobState(item.key, { text: "Đang kiểm tra và xác nhận" });
          const confirmation = (await confirmEvidences(evaluationId, [{ kind: "FILE", criterionId: row.criterionId, uploadId }])).results[0];
          if (!confirmation.ok) throw new Error(confirmation.error.message);
          jobState(item.key, { percent: 100, text: "Đã gắn minh chứng" });
        } catch (failure) {
          jobState(item.key, { failed: true, text: failure.message || "Chưa tải được tệp" });
          if (uploadId) await cancelEvidenceUpload(evaluationId, uploadId).catch(() => {});
        }
      }
    } finally { finish(); }
  }

  /** Tạo link thuần với mô tả, backend kiểm HTTP/HTTPS và không tải trang đích
   * Chỉ xóa ô nhập khi server đã lưu thành công, lỗi giữ dữ liệu để người dùng sửa
   */
  async function addLink() {
    if (!canEdit || !begin()) return;
    try {
      const result = (await confirmEvidences(evaluationId, [{ kind: "LINK", criterionId: row.criterionId, externalUrl: link, description }])).results[0];
      if (!result.ok) throw new Error(result.error.message);
      setLink(""); setDescription("");
    } catch (failure) { setError(failure.message || "Không thể thêm liên kết"); }
    finally { finish(); }
  }

  /** Xóa sau xác nhận, dùng canDelete do backend cấp và xử lý từ chối khi quyền vừa đổi */
  async function remove(item) {
    if (!begin()) return;
    try { await deleteEvidence(evaluationId, item.id); }
    catch (failure) { setError(failure.message || "Không thể xóa minh chứng"); }
    finally { finish(); }
  }

  /** Tải blob qua URL ký mới, ảnh/PDF mở modal còn Word và nút tải dùng download tường minh
   * URL chỉ tồn tại ở bộ nhớ, không lưu localStorage hoặc đưa credential vào iframe
   */
  async function open(item, inline) {
    if (!begin()) return;
    try {
      const result = await readEvidenceBlob(evaluationId, item.id, inline);
      if (!active.current) return;
      const url = URL.createObjectURL(result.blob); objectUrls.current.add(url);
      if (inline) setPreview({ url, mimeType: result.mimeType, name: item.fileName });
      else {
        // Gắn anchor vào DOM trước click để tải ổn định trên trình duyệt nhúng và chỉ thu hồi sau khi tải đã bắt đầu
        // URL vẫn được cleanup khi rời trang, không giữ blob quá một phút nếu người dùng không điều hướng
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.fileName; anchor.hidden = true;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => { URL.revokeObjectURL(url); objectUrls.current.delete(url); }, 60000);
      }
    } catch (failure) { if (active.current) setError(failure.message || "Không thể mở tệp minh chứng"); }
    finally { finish(); }
  }

  /** Đóng preview và trả bộ nhớ ngay, URL cũ không được tái sử dụng cho lần mở tiếp theo */
  function closePreview() {
    if (preview) { URL.revokeObjectURL(preview.url); objectUrls.current.delete(preview.url); }
    setPreview(null);
  }

  return <Space orientation="vertical" style={{ width: "100%" }}>
    {(row.evidences || []).map((item) => <Space key={item.id} wrap>
      <Tag>{item.round === "SUPPLEMENT" ? "Bổ sung" : "Tự chấm"}</Tag>
      {item.kind === "LINK" ? <Typography.Link href={item.externalUrl} target="_blank" rel="noopener noreferrer">{item.description || item.externalUrl}</Typography.Link> : <>
        <Typography.Text>{item.fileName}</Typography.Text>
        {["image/jpeg", "image/png", "application/pdf"].includes(item.mimeType) && <Button size="small" disabled={busy} onClick={() => open(item, true)}>Xem trước</Button>}
        <Button size="small" disabled={busy} onClick={() => open(item, false)}>Tải xuống</Button>
      </>}
      {item.canDelete && <Popconfirm title="Xóa minh chứng này?" okText="Xóa" cancelText="Giữ lại" onConfirm={() => remove(item)}><Button danger size="small" disabled={!canEdit}>Xóa</Button></Popconfirm>}
    </Space>)}
    {row.allowFile && row.canEditSelf && <Upload.Dragger multiple accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" disabled={!canEdit} showUploadList={false} beforeUpload={(file, files) => { if (files[0] === file) void upload(files); return false; }}>
      <Typography.Text>Kéo thả hoặc chọn nhiều tệp minh chứng</Typography.Text><br /><Typography.Text type="secondary">JPG, PNG, PDF, Word · Tối đa 10 MiB/tệp, 10 tệp/tiêu chí</Typography.Text>
    </Upload.Dragger>}
    {jobs.map((item) => <div key={item.key}><Typography.Text>{item.name}: {item.text}</Typography.Text><Progress percent={item.percent} status={item.failed ? "exception" : item.percent === 100 ? "success" : "active"} /></div>)}
    {row.allowLink && row.canEditSelf && <Space orientation="vertical"><Input aria-label={`Liên kết ${row.code}`} placeholder="https://..." maxLength={2048} value={link} disabled={!canEdit} onChange={(event) => setLink(event.target.value)} /><Input aria-label={`Mô tả liên kết ${row.code}`} placeholder="Mô tả liên kết" maxLength={2000} value={description} disabled={!canEdit} onChange={(event) => setDescription(event.target.value)} /><Button disabled={!canEdit || !link.trim()} onClick={addLink}>Thêm liên kết</Button></Space>}
    {error && <Alert type="error" showIcon title={error} />}
    <Modal title={preview?.name || "Xem trước minh chứng"} open={Boolean(preview)} onCancel={closePreview} footer={null} width={900} destroyOnHidden>
      {preview?.mimeType.startsWith("image/") ? <img alt="Minh chứng" src={preview.url} style={{ maxWidth: "100%" }} /> : preview && <iframe title="Xem trước PDF minh chứng" src={preview.url} style={{ width: "100%", height: "70vh", border: 0 }} />}
    </Modal>
  </Space>;
}

/** Bổ sung MIME từ extension khi trình duyệt không nhận diện Word, backend vẫn kiểm bytes thật
 * Không tự đổi MIME đã có để tránh che một tệp khai báo sai định dạng
 */
function mimeFromName(name) {
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }[name.split(".").at(-1)?.toLowerCase()] || "application/octet-stream";
}
