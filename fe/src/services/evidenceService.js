import axios from "axios";
import apiClient from "./apiClient";

const backend = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** Nối URL tương đối do backend ký vào origin API đã cấu hình, không suy ra từ origin trang FE */
function signedAddress(path) { return new URL(path, backend).href; }

/** Xin reservation qua JWT hiện tại, backend quyết định quota, round và thời gian */
export const requestEvidenceUploads = (id, items) => apiClient.post(`/evaluations/${id}/evidences/upload-urls`, { items });
/** Xác nhận từng tệp hoặc link, caller luôn kiểm results để không báo thành công sai */
export const confirmEvidences = (id, items) => apiClient.post(`/evaluations/${id}/evidences`, { items });
/** Xóa bằng quyền server và giữ audit, không trực tiếp xóa key provider tại FE */
export const deleteEvidence = (id, evidenceId) => apiClient.delete(`/evaluations/${id}/evidences/${evidenceId}`);
/** Hủy reservation lỗi để giải phóng quota, backend vẫn cleanup nếu request hủy không tới được */
export const cancelEvidenceUpload = (id, uploadId) => apiClient.delete(`/evaluations/${id}/evidences/uploads/${uploadId}`);

/** Tải bytes bằng client riêng không gắn Bearer vào capability URL, báo tiến độ chỉ cho giai đoạn truyền
 * Lỗi API có code/câu tiếng Việt được giữ, lỗi mạng/provider lạ thay bằng câu an toàn
 */
export async function uploadEvidenceBytes(grant, file, onProgress) {
  try {
    await axios.put(signedAddress(grant.uploadUrl), file, { headers: grant.requiredHeaders, timeout: 60000,
      onUploadProgress: (event) => onProgress(Math.min(99, Math.round(event.loaded * 100 / (event.total || file.size)))),
    });
  } catch (error) {
    const payload = error.response?.data;
    throw new Error(typeof payload?.code === "string" && /[À-ỹ]/u.test(payload.message ?? "") ? payload.message : "Không thể tải tệp vào kho, vui lòng thử lại");
  }
}

/** Xin URL mới có Auth rồi đọc blob không Bearer, Word luôn tải còn ảnh/PDF có thể xem inline
 * Blob chỉ ở bộ nhớ trình duyệt, component sở hữu việc thu hồi URL khi đóng/rời trang
 */
export async function readEvidenceBlob(id, evidenceId, preview = false) {
  const metadata = await apiClient.get(`/evaluations/${id}/evidences/${evidenceId}${preview ? "/preview" : ""}`);
  try {
    const response = await axios.get(signedAddress(preview ? metadata.url : metadata.downloadUrl), { responseType: "blob", timeout: 60000 });
    return { blob: response.data, mimeType: metadata.mimeType, fileName: metadata.fileName };
  } catch { throw new Error("Liên kết tệp đã hết hạn hoặc chưa tải được, vui lòng mở lại"); }
}
