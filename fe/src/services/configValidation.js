/** Đổi các thành phần giờ Việt Nam trong picker sang instant, độc lập múi giờ máy. */
export function fromVietnamDatePicker(value) {
  if (!value) return null;
  return new Date(Date.UTC(value.year(), value.month(), value.date(), value.hour() - 7, value.minute(), value.second(), value.millisecond())).toISOString();
}

/** Kiểm trước khi gửi; API kiểm lại theo đồng hồ server tại lúc lưu. */
export function scheduleError(range, now = Date.now()) {
  if (!range?.length) return null;
  if (!range[0] || !range[1]) return "Vui lòng chọn đủ thời gian bắt đầu và kết thúc";
  const start = Date.parse(fromVietnamDatePicker(range[0]));
  const end = Date.parse(fromVietnamDatePicker(range[1]));
  if (start <= now) return "Thời gian bắt đầu phải sau thời gian hiện tại";
  if (start >= end) return "Thời gian bắt đầu phải sớm hơn thời hạn tự đánh giá";
  return null;
}

/** So điểm theo phần trăm của một điểm để cộng 0,1 + 0,2 không vượt nhầm 0,3. */
export function criterionScoreError(tree, { id, parentId, maxScore }) {
  if (maxScore == null) return null;
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
  const nodes = flatten(tree);
  const cents = (value) => Math.round(Number(value) * 100);
  const score = cents(maxScore);
  if (score <= 0) return "Điểm tối đa phải lớn hơn 0";
  const sum = (items) => items.reduce((total, node) => total + cents(node.maxScore), 0);
  if (parentId) {
    const parent = nodes.find((node) => node.id === parentId);
    if (!parent) return "Tiêu chí cha phải thuộc cùng kỳ đánh giá";
    if (score > cents(parent.maxScore)) return "Điểm tối đa của tiêu chí con không được lớn hơn điểm tối đa của tiêu chí cha";
    if (sum(nodes.filter((node) => node.parentId === parentId && node.id !== id)) + score > cents(parent.maxScore)) {
      return "Tổng điểm tối đa các tiêu chí con không được vượt điểm tối đa của tiêu chí cha";
    }
  }
  if (id && sum(nodes.filter((node) => node.parentId === id)) > score) {
    return "Điểm tối đa của tiêu chí cha không được nhỏ hơn tổng điểm tối đa các tiêu chí con hiện có";
  }
  return null;
}
