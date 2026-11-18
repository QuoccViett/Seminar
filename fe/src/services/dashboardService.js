import apiClient from "./apiClient";

export const dashboardService = {
  /** Đọc số liệu tiến độ của một kỳ UUID, quyền và thời điểm do backend kiểm */
  getDashboardStats: (periodId) => {
    return apiClient.get("/admin/dashboard", { params: { periodId } });
  },
  
  /** Chỉ đọc những ô đã thẩm định và chốt để số điểm trừ không tính nhầm ô chưa duyệt */
  getCriteriaDeductions: (periodId) => {
    return apiClient.get("/admin/dashboard/criteria-deductions", { params: { periodId } });
  },
  /** Đọc từng hồ sơ đã chốt bị trừ ở một tiêu chí, UUID kỳ vẫn được backend kiểm lại */
  getDeductionDetail: (periodId, criterionId) => apiClient.get(`/admin/dashboard/criteria-deductions/${criterionId}`, { params: { periodId } }),
  /** Đọc thứ hạng do view SQL tính trên toàn kỳ, limit chỉ giới hạn số dòng hiển thị */
  getLeaderboard: (periodId, limit = 20) => apiClient.get("/admin/dashboard/leaderboard", { params: { periodId, limit } }),
  /** Đọc phổ điểm chính thức theo khoảng phần trăm và loại từ hồ sơ đã chốt */
  getScoreDistribution: (periodId) => apiClient.get("/admin/dashboard/score-distribution", { params: { periodId } }),
};
