/** Gắn lỗi backend vào trường Ant Form, đường dẫn nested giữ nguyên thứ tự và chỉ số mảng
 * Trả câu đầy đủ để toast không nuốt lỗi nghiệp vụ không gắn được vào trường đang hiển thị
 * Adapter API đã loại lỗi thô trước khi hàm này được gọi
 * aliases ghép field API vào control tổng hợp như selfEvalRange, giữ nguyên định danh của lỗi gốc
 */
export function applyFormError(form, failure, fallback, aliases = {}) {
  const details = failure.fieldErrors ?? [];
  form?.setFields(details.map((item) => ({ name: (aliases[item.field] ?? item.field).replace(/\[(\d+)\]/g, ".$1").split(".").map((part) => /^\d+$/.test(part) ? Number(part) : part), errors: item.messages })));
  return [failure.message || fallback, ...details.flatMap((item) => item.messages)].filter(Boolean).join("; ");
}
