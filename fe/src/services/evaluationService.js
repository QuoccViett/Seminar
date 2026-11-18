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
/** Nộp vòng bổ sung, server kiểm lại hạn và thay đổi thực tế trước khi khóa */
export const submitSupplement = (id) => apiClient.post(`/evaluations/${id}/supplement-submit`, {});
/** Lưu một điểm thẩm định, lý do và giới hạn được backend kiểm lại */
export const reviewScore = (id, criterionId, body) => apiClient.put(`/admin/evaluations/${id}/scores/${criterionId}/review`, body);
/** Chấp nhận các ô chưa được duyệt, backend bảo vệ điểm đã sửa */
export const acceptAllScores = (id) => apiClient.post(`/admin/evaluations/${id}/accept-all`, {});
/** Hoàn tất lượt đầu sau khi server kiểm đủ các lá */
export const completeFirstReview = (id) => apiClient.post(`/admin/evaluations/${id}/first-review-complete`, {});
/** Yêu cầu bổ sung với lịch và ghi chú từng lá, server tính hạn */
export const requestSupplement = (id, body) => apiClient.post(`/admin/evaluations/${id}/supplement-request`, body);
/** Chốt kết quả chính thức sau khi server kiểm giai đoạn và trạng thái */
export const finalizeEvaluation = (id) => apiClient.post(`/admin/evaluations/${id}/finalize`, {});
/** Xem điểm dự kiến từ server trước khi xác nhận, không tự cấp quyền chốt */
export const previewFinalize = (ids) => apiClient.post("/admin/evaluations/finalize-preview", { evaluationIds: ids });
/** Đọc projection thẩm định và baseline chỉ dành cho Admin qua route có guard */
export const getReview = (id) => apiClient.get(`/admin/evaluations/${id}/review`);
/** Lưu nháp nhiều ô với transaction độc lập, caller phải giữ các ô lỗi để thử lại */
export const reviewScores = (id, items) => apiClient.put(`/admin/evaluations/${id}/scores/review-batch`, { items });
/** Chốt nhiều hồ sơ sau preview, mỗi kết quả có cờ ok và lỗi an toàn riêng */
export const finalizeEvaluations = (ids) => apiClient.post("/admin/evaluations/finalize-batch", { evaluationIds: ids });
