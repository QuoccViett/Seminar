-- Lưu deadline loại trừ của tin mở hoặc nhắc để worker không bắt đầu gửi sau hạn
-- Cột nullable giữ tương thích toàn bộ thông báo cũ và không thay nội dung hộp thư
ALTER TABLE "notifications" ADD COLUMN "expires_at" TIMESTAMP(6);
