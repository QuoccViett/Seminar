import axios from "axios";
import { getAccessToken, getRefreshToken, setSession, clearSession } from "./session";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
// Cho phép kết nối chậm tối đa 30 giây, backend vẫn kiểm quyền tại thời điểm ghi sau khi lấy khóa
// Hết thời gian chỉ báo lỗi và giữ nháp, không tự nhận rằng một lệnh ghi đã thành công
const REQUEST_TIMEOUT = 30000;
const apiClient = axios.create({ baseURL: `${API_BASE}/api/v1`, timeout: REQUEST_TIMEOUT, headers: { "Content-Type": "application/json" } });
const refreshFlights = new Map();

/** Gắn token mới nhất cho yêu cầu có phiên, kể cả sau refresh
 * Endpoint public có token mời riêng phải bỏ Bearer để không gắn nhầm tài khoản đang mở trang
 */
apiClient.interceptors.request.use((config) => {
  if (config.authMode === "public") {
    for (const key of Object.keys(config.headers ?? {})) if (key.toLowerCase() === "authorization") delete config.headers[key];
    return config;
  }
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Chia sẻ một yêu cầu xoay vòng giữa các lỗi 401 đồng thời để tránh dùng lại refresh token
 * Gọi Axios riêng để lỗi làm mới không chạy lại interceptor và không tạo vòng lặp
 * Chỉ lưu phiên khi phản hồi đầy đủ, mọi lỗi đều chuyển về nhánh xóa phiên của bên gọi
 */
function refreshSession() {
  const token = getRefreshToken();
  // Chỉ gom request của cùng một phiên, phiên đăng nhập mới không được chờ chuyến refresh cũ
  // Map chỉ giữ promise đang chạy, xóa khi xong và không lưu credential ngoài bộ nhớ của phiên
  if (!refreshFlights.has(token)) {
    const pending = (async () => {
      if (!token) throw new Error("Không có phiên làm mới.");
      const response = await axios.post(`${API_BASE}/api/v1/auth/refresh`, { refreshToken: token }, { timeout: REQUEST_TIMEOUT });
      const result = response.data?.data ?? response.data;
      if (!result?.accessToken || !result?.refreshToken || !result?.user) throw new Error("Phản hồi làm mới phiên không hợp lệ.");
      // Không phục hồi lại phiên nếu người dùng đã đăng xuất hoặc thay phiên trong lúc chờ
      if (getRefreshToken() !== token) throw new Error("Phiên đăng nhập đã thay đổi.");
      setSession(result);
    })().finally(() => { refreshFlights.delete(token); });
    refreshFlights.set(token, pending);
  }
  return refreshFlights.get(token);
}

/** Chuẩn hóa lỗi để giao diện không nhận đối tượng Axios có thể chứa token hoặc mật khẩu
 * Giữ mã kỹ thuật và lỗi trường từ backend, thay lỗi mạng hoặc phản hồi lạ bằng tiếng Việt
 */
export function normalizeError(error) {
  const status = error.response?.status;
  const payload = error.response?.data;
  const safe = (message) => typeof message === "string" && /[À-ỹ]/u.test(message) && !/Prisma|SQLSTATE|SELECT\s|INSERT\s|passwordHash|stack\s*trace/i.test(message);
  const fallback = error.code === "ECONNABORTED" ? "Kết nối quá thời gian. Vui lòng thử lại." : status === 403 ? "Bạn không có quyền thực hiện thao tác này." : status === 404 ? "Không tìm thấy dữ liệu được yêu cầu." : status ? "Không thể xử lý yêu cầu. Vui lòng thử lại." : "Không thể kết nối máy chủ. Vui lòng thử lại.";
  const fieldErrors = Array.isArray(payload?.details) ? payload.details.filter((item) => typeof item?.field === "string" && Array.isArray(item.messages)).map((item) => ({ field: item.field, messages: item.messages.map((message) => safe(message) ? message : "Dữ liệu trường này không hợp lệ.") })) : [];
  return { status, code: typeof payload?.code === "string" ? payload.code : null, message: typeof payload?.code === "string" && safe(payload?.message) ? payload.message : fallback, fieldErrors };
}

/** Giữ metadata khi giải envelope, danh sách hiện hành được trả nguyên shape
 * Hỗ trợ data/meta ở biên tương thích, sau khi giữ danh sách trực tiếp mới giải lớp data theo contract
 */
export function unwrapResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if ("items" in payload || "total" in payload || "page" in payload) return payload;
  if (payload.meta && Array.isArray(payload.data)) return { items: payload.data, ...payload.meta };
  return payload.data ?? payload;
}

apiClient.interceptors.response.use(
  (response) => {
    if (response.status === 204) return null;
    if (response.config.responseType === "blob") return response;
    return unwrapResponse(response.data);
  },
  /** Thử lại tối đa một lần sau 401 ngoài các endpoint xác thực công khai
   * Khi làm mới thất bại thì xóa phiên và phát sự kiện để giao diện chuyển về đăng nhập
   */
  async (error) => {
    if (configPublic(error.config) === false && error.response?.status === 403 && error.response?.data?.code === "PASSWORD_CHANGE_REQUIRED") {
      window.dispatchEvent(new CustomEvent("auth:password-required"));
    }
    const config = error.config;
    const url = config?.url ?? "";
    const publicAuth = configPublic(config) || url.includes("/auth/login") || url.includes("/auth/refresh") || url.includes("/auth/logout");
    if (error.response?.status === 401 && config && !publicAuth && !config._authRetried) {
      config._authRetried = true;
      const refreshTokenAtStart = getRefreshToken();
      try {
        // Nếu yêu cầu cũ nhận 401 trễ sau khi phiên đã xoay vòng, dùng token mới thay vì xoay vòng lần nữa
        const sentToken = config.headers?.Authorization?.replace(/^Bearer\s+/i, "");
        if (!sentToken || sentToken === getAccessToken()) await refreshSession();
        return apiClient(config);
      } catch {
        // Refresh của phiên đã đăng xuất không được xóa danh tính vừa đăng nhập trong lúc chờ mạng
        // Chỉ phiên vẫn trùng mốc bắt đầu mới nhận thông báo hết hạn và lệnh xóa kho nháp
        if (getRefreshToken() === refreshTokenAtStart) {
          clearSession();
          window.dispatchEvent(new CustomEvent("auth:unauthorized"));
        }
      }
    } else if (error.response?.status === 401 && config?._authRetried && !publicAuth) {
      const sentToken = config.headers?.Authorization?.replace(/^Bearer\s+/i, "");
      if (sentToken === getAccessToken()) {
        clearSession();
        window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      }
    }
    return Promise.reject(normalizeError(error));
  },
);

export default apiClient;

/** Endpoint công khai có quyền hẹp từ token mời, không dùng hoặc làm mất phiên nghiệp vụ hiện tại */
function configPublic(config) { return config?.authMode === "public"; }
