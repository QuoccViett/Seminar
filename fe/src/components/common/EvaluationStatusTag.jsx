import { Tag } from "antd";

const statusColors = {
  DRAFT: "blue", PENDING_REVIEW: "gold", SUPPLEMENT_REQUESTED: "gold",
  SUPPLEMENT_SUBMITTED: "blue", SUPPLEMENT_EXPIRED: "red", FINALIZED: "green",
};

/** Số 0 chỉ trung tính ở tag thống kê, không làm mất màu trạng thái hồ sơ */
export default function EvaluationStatusTag({ status, count, children }) {
  return <Tag color={count === 0 ? undefined : statusColors[status]}>{children}</Tag>;
}
