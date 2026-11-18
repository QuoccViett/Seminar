const ACCESS_KEY  = "accessToken";
const REFRESH_KEY = "refreshToken";
const USER_KEY    = "currentUser";

export const getAccessToken  = () => sessionStorage.getItem(ACCESS_KEY);
export const getRefreshToken = () => sessionStorage.getItem(REFRESH_KEY);
export const getCurrentUser  = () => {
  try { return JSON.parse(sessionStorage.getItem(USER_KEY) || "null"); }
  catch { return null; }
};

/** Lưu token và hồ sơ do server cấp, phát sự kiện cho tab hiện tại sau refresh
 * expiresIn chỉ phục vụ nhắc phiên, tuyệt đối không dùng để cấp quyền nghiệp vụ
 */
export const setSession = ({ accessToken, refreshToken, user, expiresIn }) => {
  if (accessToken)  sessionStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
  if (user)         sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  if (Number.isFinite(expiresIn)) sessionStorage.setItem("sessionExpiresAt", String(Date.now() + expiresIn * 1000));
  window.dispatchEvent(new CustomEvent("auth:session", { detail: user }));
};

/** Xóa toàn bộ danh tính và lựa chọn thuộc phiên khi đăng xuất hoặc máy chủ từ chối phiên */
export const clearSession = () => {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem("sessionExpiresAt");
  sessionStorage.removeItem("selectedPeriodId");
  window.dispatchEvent(new CustomEvent("workspace:clear"));
};
