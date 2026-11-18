-- Bảo vệ phản hồi như lịch sử bất biến, không sửa/xóa nội dung đã được trao đổi
-- Dùng hàm VC03 đã có câu lỗi tiếng Việt, không thay migration từng áp dụng
-- Không thêm CHECK độ dài lên dữ liệu cũ vì yêu cầu VC12 có thể chứa nhiều ghi chú
CREATE TRIGGER "evaluation_feedbacks_append_only"
  BEFORE UPDATE OR DELETE ON "evaluation_feedbacks"
  FOR EACH ROW EXECUTE FUNCTION "forbid_row_change"();
