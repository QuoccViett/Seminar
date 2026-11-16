import axios from "axios";
import { getAccessToken, getRefreshToken, setSession, clearSession } from "./session";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const apiClient = axios.create({ baseURL: `${API_BASE}/api/v1`, timeout: 15000, headers: { "Content-Type": "application/json" } });
let refreshing = null;

/** Gắn access token mới nhất cho từng yêu cầu, kể cả yêu cầu được thử lại sau làm mới */
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Chia sẻ một yêu cầu xoay vòng giữa các lỗi 401 đồng thời để tránh dùng lại refresh token
 * Gọi Axios riêng để lỗi làm mới không chạy lại interceptor và không tạo vòng lặp
 * Chỉ lưu phiên khi phản hồi đầy đủ, mọi lỗi đều chuyển về nhánh xóa phiên của bên gọi
 */
function refreshSession() {
  if (!refreshing) {
    const token = getRefreshToken();
    refreshing = (async () => {
      if (!token) throw new Error("Không có phiên làm mới.");
      const response = await axios.post(`${API_BASE}/api/v1/auth/refresh`, { refreshToken: token }, { timeout: 15000 });
      const result = response.data?.data ?? response.data;
      if (!result?.accessToken || !result?.refreshToken || !result?.user) throw new Error("Phản hồi làm mới phiên không hợp lệ.");
      // Không phục hồi lại phiên nếu người dùng đã đăng xuất hoặc thay phiên trong lúc chờ
      if (getRefreshToken() !== token) throw new Error("Phiên đăng nhập đã thay đổi.");
      setSession(result);
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** Chuẩn hóa lỗi để giao diện không nhận đối tượng Axios có thể chứa token hoặc mật khẩu
 * Giữ mã kỹ thuật và lỗi trường từ backend, thay lỗi mạng hoặc phản hồi lạ bằng tiếng Việt
 */
function normalizeError(error) {
  const status = error.response?.status;
  const payload = error.response?.data;
  return { status, code: payload?.code ?? null, message: typeof payload?.code === "string" && typeof payload?.message === "string" && /[À-ỹ]/u.test(payload.message) ? payload.message : error.code === "ECONNABORTED" ? "Kết nối quá thời gian. Vui lòng thử lại." : status ? "Không thể xử lý yêu cầu. Vui lòng thử lại." : "Không thể kết nối máy chủ. Vui lòng thử lại.", fieldErrors: Array.isArray(payload?.details) ? payload.details : [] };
}

apiClient.interceptors.response.use(
  (response) => {
    if (response.status === 204) return null;
    if (response.config.responseType === "blob") return response;
    return response.data?.data ?? response.data;
  },
  /** Thử lại tối đa một lần sau 401 ngoài các endpoint xác thực công khai
   * Khi làm mới thất bại thì xóa phiên và phát sự kiện để giao diện chuyển về đăng nhập
   */
  async (error) => {
    const config = error.config;
    const url = config?.url ?? "";
    const publicAuth = url.includes("/auth/login") || url.includes("/auth/refresh") || url.includes("/auth/logout");
    if (error.response?.status === 401 && config && !publicAuth && !config._authRetried) {
      config._authRetried = true;
      try {
        // Nếu yêu cầu cũ nhận 401 trễ sau khi phiên đã xoay vòng, dùng token mới thay vì xoay vòng lần nữa
        const sentToken = config.headers?.Authorization?.replace(/^Bearer\s+/i, "");
        if (!sentToken || sentToken === getAccessToken()) await refreshSession();
        return apiClient(config);
      } catch {
        clearSession();
        window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      }
    } else if (error.response?.status === 401 && config?._authRetried) {
      clearSession();
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }
    return Promise.reject(normalizeError(error));
  },
);

export default apiClient;
