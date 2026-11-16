-- Phiên bản mặc định bằng không giữ nguyên người dùng hiện có khi nâng cấp cơ sở dữ liệu
-- Access token cũ không có phiên bản sẽ bị từ chối để buộc đăng nhập lại an toàn
ALTER TABLE "users" ADD COLUMN "credential_version" INTEGER NOT NULL DEFAULT 0;
