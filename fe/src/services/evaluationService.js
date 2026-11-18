import apiClient from "./apiClient";

/** Đọc metadata theo quyền từ phiên, params chỉ có bộ lọc và phân trang */
export const listEvaluations = (params) => apiClient.get("/evaluations", { params });
/** Tạo bù idempotent, UNIT không gửi unitId còn ADMIN chỉ định đơn vị */
export const createEvaluation = (periodId, unitId) => apiClient.post("/evaluations", { periodId, ...(unitId ? { unitId } : {}) });
/** Đọc cây và quyền từng lá do server kiểm giờ, không dùng giờ máy để cấp quyền */
export const getEvaluation = (id) => apiClient.get(`/evaluations/${id}`);
/** Nhận tổng tự chấm tạm tính từ server, không cộng điểm Admin hoặc tính tổng tại FE */
export const getScoreSummary = (id) => apiClient.get(`/evaluations/${id}/score-summary`);
/** Lưu từng ô bằng transaction độc lập, caller phải kiểm results thay vì chỉ HTTP 200 */
export const saveSelfScores = (id, items) => apiClient.put(`/evaluations/${id}/scores/self-batch`, { items });
/** Nộp bằng lệnh rỗng, server tự cấp submittedAt và khóa chỉnh sửa */
export const submitEvaluation = (id) => apiClient.post(`/evaluations/${id}/submit`, {});
