-- Cho phép xóa vật liệu giải mã khi mật khẩu đổi, hết TTL hoặc đã gửi xong mà vẫn giữ lịch sử trạng thái kênh
-- Bộ ba ciphertext/nonce/auth_tag phải cùng có hoặc cùng rỗng để worker không đọc payload dở dang
ALTER TABLE "credential_dispatches" DROP CONSTRAINT "credential_dispatches_crypto_check";
ALTER TABLE "credential_dispatches" ALTER COLUMN "ciphertext" DROP NOT NULL;
ALTER TABLE "credential_dispatches" ALTER COLUMN "nonce" DROP NOT NULL;
ALTER TABLE "credential_dispatches" ALTER COLUMN "auth_tag" DROP NOT NULL;
ALTER TABLE "credential_dispatches" ADD COLUMN "email_confirmed_at" timestamp(6);
ALTER TABLE "credential_dispatches" ADD CONSTRAINT "credential_dispatches_crypto_check"
  CHECK (("ciphertext" IS NULL AND "nonce" IS NULL AND "auth_tag" IS NULL)
      OR ("ciphertext" IS NOT NULL AND length("ciphertext") > 0
          AND "nonce" IS NOT NULL AND length("nonce") > 0
          AND "auth_tag" IS NOT NULL AND length("auth_tag") > 0));
