import axios from "axios";
import { getAccessToken, clearSession } from "./session";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

const apiClient = axios.create({
  baseURL: `${API_BASE}/api/v1`,         
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});


apiClient.interceptors.response.use(
  (response) => {
    if (response.status === 204) return null;
    if (response.config.responseType === "blob") return response;
    // theo contract đã chốt: { data, meta } | mảng trực tiếp
    return response.data?.data ?? response.data;
  },
  /** Chuẩn hóa lỗi API cho giao diện mà không giữ đối tượng Axios chứa token và body
   * Với 401 ngoài đăng nhập hoặc làm mới, xóa phiên và thông báo cho bộ điều hướng
   * Lỗi mạng và phản hồi không theo contract được thay bằng câu tiếng Việt cố định
   */
  (error) => {
    const status  = error.response?.status;
    const payload = error.response?.data;

if (status === 401) {
  const url = error.config?.url ?? "";
  const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/refresh");
  if (!isAuthEndpoint) {
    clearSession();
    window.dispatchEvent(new CustomEvent("auth:unauthorized"));
  }
}

return Promise.reject({
  status,
  code:        payload?.code ?? null,
  message:     typeof payload?.code === "string" && typeof payload?.message === "string" && /[À-ỹ]/u.test(payload.message)
    ? payload.message : error.code === "ECONNABORTED" ? "Kết nối quá thời gian. Vui lòng thử lại." : status ? "Không thể xử lý yêu cầu. Vui lòng thử lại." : "Không thể kết nối máy chủ. Vui lòng thử lại.",
  fieldErrors: Array.isArray(payload?.details) ? payload.details : [],
});
  }
);

export default apiClient;
