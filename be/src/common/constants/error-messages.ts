import { ERROR_CODES } from "./error-codes.js";

/** Danh mục câu công khai cố định, không chứa giá trị đầu vào hoặc lỗi từ nhà cung cấp */
export const ERROR_MESSAGES: Record<string, string> = {
  [ERROR_CODES.VALIDATION_ERROR]: "Dữ liệu gửi lên không hợp lệ.",
  [ERROR_CODES.UNAUTHORIZED]: "Bạn cần đăng nhập để tiếp tục.",
  [ERROR_CODES.FORBIDDEN]: "Bạn không có quyền thực hiện thao tác này.",
  [ERROR_CODES.NOT_FOUND]: "Không tìm thấy dữ liệu được yêu cầu.",
  [ERROR_CODES.CONFLICT]: "Dữ liệu bị xung đột.",
  [ERROR_CODES.USERNAME_TAKEN]: "Tên đăng nhập đã được sử dụng.",
  [ERROR_CODES.UNIT_CODE_TAKEN]: "Mã đơn vị đã tồn tại.",
  [ERROR_CODES.REFERENCE_IN_USE]: "Dữ liệu đang được sử dụng nên chưa thể xóa.",
  [ERROR_CODES.DB_RULE_VIOLATION]: "Quy tắc dữ liệu không cho phép thao tác này.",
  [ERROR_CODES.FILE_TOO_LARGE]: "Dữ liệu hoặc tệp vượt quá dung lượng cho phép.",
  [ERROR_CODES.UNSUPPORTED_MEDIA_TYPE]: "Định dạng dữ liệu không được hỗ trợ.",
  [ERROR_CODES.TOO_MANY_REQUESTS]: "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
  [ERROR_CODES.METHOD_NOT_ALLOWED]: "Phương thức yêu cầu không được hỗ trợ.",
  [ERROR_CODES.DATABASE_UNAVAILABLE]: "Chưa thể kết nối cơ sở dữ liệu. Vui lòng thử lại sau.",
  [ERROR_CODES.INTERNAL_ERROR]: "Hệ thống đang gặp sự cố. Vui lòng thử lại sau.",
};
