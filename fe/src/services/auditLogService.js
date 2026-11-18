import apiClient from "./apiClient";

/** Đọc route ADMIN theo contract VC13, query chỉ chứa bộ lọc và pagination đã chuẩn hóa */
export const auditLogService = {
  getAuditLogs: (params) => apiClient.get("/admin/audit-logs", { params }),
  /** Đọc snapshot trước/sau đã được backend che bí mật, không suy ra chi tiết từ dòng tóm tắt */
  getAuditLog: (id) => apiClient.get(`/admin/audit-logs/${id}`),
};
