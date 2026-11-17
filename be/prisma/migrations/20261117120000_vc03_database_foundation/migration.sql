BEGIN;

-- Bổ sung snapshot mở lịch bổ sung và dấu thời gian nội dung bổ sung thật sự thay đổi
-- supplement_hours được giữ nguyên để tương thích dữ liệu cũ, không còn là nguồn tính lịch mới
ALTER TABLE "evaluations"
  ADD COLUMN "supplement_start_at" timestamp(6);

ALTER TABLE "criterion_scores"
  ADD COLUMN "supplemented_at" timestamp(6);

-- Lease giúp worker phân biệt việc đang được xử lý với việc có thể nhận lại sau khi tiến trình dừng
ALTER TABLE "notification_deliveries"
  ADD COLUMN "claimed_at" timestamp(6),
  ADD COLUMN "lease_until" timestamp(6),
  ADD COLUMN "claim_token" uuid,
  ADD COLUMN "reason_code" varchar;

-- Mỗi phiên import gắn với Admin, dấu vân tay tệp, bản xem trước chuẩn hóa và kết quả xác nhận idempotent
-- rows không được dùng để chứa mật khẩu hoặc bí mật xác thực
CREATE TABLE "import_sessions" (
  "id" uuid NOT NULL,
  "admin_id" uuid NOT NULL,
  "file_digest" varchar NOT NULL,
  "rows" json NOT NULL,
  "status" varchar NOT NULL DEFAULT 'PREVIEWED',
  "idempotency_key" varchar NOT NULL,
  "result" json,
  "expires_at" timestamp(6) NOT NULL,
  "confirmed_at" timestamp(6),
  "created_at" timestamp(6) NOT NULL,
  "updated_at" timestamp(6) NOT NULL,
  CONSTRAINT "import_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_sessions_status_check" CHECK ("status" IN ('PREVIEWED', 'CONFIRMED', 'EXPIRED')),
  CONSTRAINT "import_sessions_confirmation_check" CHECK (
    ("status" = 'CONFIRMED' AND "confirmed_at" IS NOT NULL AND "result" IS NOT NULL)
    OR ("status" <> 'CONFIRMED' AND "confirmed_at" IS NULL)
  ),
  CONSTRAINT "import_sessions_digest_check" CHECK ("file_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "import_sessions_idempotency_key_check" CHECK (length("idempotency_key") BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX "import_sessions_admin_id_idempotency_key_key"
  ON "import_sessions" ("admin_id", "idempotency_key");
CREATE INDEX "import_sessions_status_expires_at_idx"
  ON "import_sessions" ("status", "expires_at");
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Onboarding chỉ lưu hash token, gắn mục đích và phiên bản credential để vô hiệu hóa liên kết cũ
CREATE TABLE "onboarding_tokens" (
  "id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "purpose" varchar NOT NULL,
  "credential_version" integer NOT NULL,
  "token_hash" varchar NOT NULL,
  "expires_at" timestamp(6) NOT NULL,
  "used_at" timestamp(6),
  "created_at" timestamp(6) NOT NULL,
  CONSTRAINT "onboarding_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "onboarding_tokens_purpose_check" CHECK ("purpose" IN ('WEB_PUSH', 'EMAIL', 'ZALO_ZNS')),
  CONSTRAINT "onboarding_tokens_version_check" CHECK ("credential_version" >= 0),
  CONSTRAINT "onboarding_tokens_expiry_check" CHECK ("expires_at" > "created_at")
);
CREATE UNIQUE INDEX "onboarding_tokens_token_hash_key" ON "onboarding_tokens" ("token_hash");
CREATE INDEX "onboarding_tokens_user_id_purpose_expires_at_idx"
  ON "onboarding_tokens" ("user_id", "purpose", "expires_at");
ALTER TABLE "onboarding_tokens" ADD CONSTRAINT "onboarding_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Credential dispatch chứa duy nhất ciphertext cùng metadata giải mã, không có cột bí mật dạng rõ
CREATE TABLE "credential_dispatches" (
  "id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "credential_version" integer NOT NULL,
  "ciphertext" text NOT NULL,
  "nonce" varchar NOT NULL,
  "auth_tag" varchar NOT NULL,
  "key_id" varchar NOT NULL,
  "expires_at" timestamp(6) NOT NULL,
  "canceled_at" timestamp(6),
  "created_at" timestamp(6) NOT NULL,
  CONSTRAINT "credential_dispatches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credential_dispatches_version_check" CHECK ("credential_version" >= 0),
  CONSTRAINT "credential_dispatches_crypto_check" CHECK (
    length("ciphertext") > 0 AND length("nonce") > 0 AND length("auth_tag") > 0 AND length("key_id") > 0
  ),
  CONSTRAINT "credential_dispatches_expiry_check" CHECK ("expires_at" > "created_at")
);
CREATE UNIQUE INDEX "credential_dispatches_user_id_credential_version_key"
  ON "credential_dispatches" ("user_id", "credential_version");
CREATE INDEX "credential_dispatches_expires_at_canceled_at_idx"
  ON "credential_dispatches" ("expires_at", "canceled_at");
ALTER TABLE "credential_dispatches" ADD CONSTRAINT "credential_dispatches_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Lịch sử từng kênh độc lập với hộp thư, chỉ giữ mã lỗi ổn định và ID tham chiếu nhà cung cấp
CREATE TABLE "credential_deliveries" (
  "id" uuid NOT NULL,
  "dispatch_id" uuid NOT NULL,
  "channel" varchar NOT NULL,
  "status" varchar NOT NULL DEFAULT 'PENDING',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "claimed_at" timestamp(6),
  "lease_until" timestamp(6),
  "claim_token" uuid,
  "next_attempt_at" timestamp(6),
  "error_code" varchar,
  "message_id" varchar,
  "sent_at" timestamp(6),
  "created_at" timestamp(6) NOT NULL,
  "updated_at" timestamp(6) NOT NULL,
  CONSTRAINT "credential_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credential_deliveries_channel_check" CHECK ("channel" IN ('WEB_PUSH', 'EMAIL', 'ZALO_ZNS')),
  CONSTRAINT "credential_deliveries_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT "credential_deliveries_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "credential_deliveries_lease_check" CHECK (
    ("claimed_at" IS NULL AND "lease_until" IS NULL AND "claim_token" IS NULL)
    OR ("claimed_at" IS NOT NULL AND "lease_until" IS NOT NULL AND "claim_token" IS NOT NULL
      AND "lease_until" > "claimed_at")
  ),
  CONSTRAINT "credential_deliveries_sent_check" CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "credential_deliveries_dispatch_id_channel_key"
  ON "credential_deliveries" ("dispatch_id", "channel");
CREATE INDEX "credential_deliveries_status_next_attempt_at_lease_until_idx"
  ON "credential_deliveries" ("status", "next_attempt_at", "lease_until");
ALTER TABLE "credential_deliveries" ADD CONSTRAINT "credential_deliveries_dispatch_id_fkey"
  FOREIGN KEY ("dispatch_id") REFERENCES "credential_dispatches" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Chỉ lưu cấu hình Zalo đã mã hóa để chuẩn bị tích hợp, không bật ZNS và không gọi nhà cung cấp
CREATE TABLE "zalo_connections" (
  "id" uuid NOT NULL,
  "admin_id" uuid NOT NULL,
  "ciphertext" text NOT NULL,
  "nonce" varchar NOT NULL,
  "auth_tag" varchar NOT NULL,
  "key_id" varchar NOT NULL,
  "token_expiry" timestamp(6),
  "version" integer NOT NULL DEFAULT 1,
  "locked_at" timestamp(6),
  "created_at" timestamp(6) NOT NULL,
  "updated_at" timestamp(6) NOT NULL,
  CONSTRAINT "zalo_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zalo_connections_version_key" UNIQUE ("version"),
  CONSTRAINT "zalo_connections_version_check" CHECK ("version" > 0),
  CONSTRAINT "zalo_connections_crypto_check" CHECK (
    length("ciphertext") > 0 AND length("nonce") > 0 AND length("auth_tag") > 0 AND length("key_id") > 0
  )
);
ALTER TABLE "zalo_connections" ADD CONSTRAINT "zalo_connections_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Lease notification dùng nguyên tử khi claim; CHECK ngăn token rời rạc hoặc thời hạn lease ngược
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_lease_check" CHECK (
    ("claimed_at" IS NULL AND "lease_until" IS NULL AND "claim_token" IS NULL)
    OR ("claimed_at" IS NOT NULL AND "lease_until" IS NOT NULL AND "claim_token" IS NOT NULL
      AND "lease_until" > "claimed_at")
  );
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_reason_code_check"
  CHECK ("reason_code" IS NULL OR length("reason_code") BETWEEN 1 AND 100);
CREATE INDEX "notification_deliveries_lease_until_idx"
  ON "notification_deliveries" ("lease_until");

-- Hạn kỳ bổ sung phải khớp thứ tự snapshot, còn trạng thái mở phải có đủ mốc được server lưu
ALTER TABLE "evaluations"
  ADD CONSTRAINT "evaluations_supplement_window_check" CHECK (
    "supplement_start_at" IS NULL
    OR ("supplement_deadline" IS NOT NULL
      AND "supplement_start_at" < "supplement_deadline")
  );
ALTER TABLE "users"
  ADD CONSTRAINT "users_credential_version_nonnegative_check" CHECK ("credential_version" >= 0);

-- Giữ mã lỗi ổn định khi tiêu chí cha thuộc đợt khác, đồng thời dùng câu tiếng Việt ở tầng cơ sở dữ liệu
CREATE OR REPLACE FUNCTION "check_criteria_parent_period"() RETURNS trigger AS $$
DECLARE
  parent_period_id uuid;
BEGIN
  IF NEW."parent_id" IS NOT NULL THEN
    SELECT "period_id" INTO parent_period_id FROM "criteria" WHERE "id" = NEW."parent_id";
    IF parent_period_id IS DISTINCT FROM NEW."period_id" THEN
      RAISE EXCEPTION 'Tiêu chí cha và tiêu chí con phải thuộc cùng một đợt thi đua'
        USING ERRCODE = '23514', DETAIL = 'CRITERION_PARENT_PERIOD_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Lịch sử kiểm toán và chuyển trạng thái chỉ nhận INSERT để bảo đảm khả năng truy vết
CREATE OR REPLACE FUNCTION "forbid_row_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Nhật ký kiểm toán và lịch sử trạng thái chỉ được phép thêm mới'
    USING ERRCODE = '23514', DETAIL = 'HISTORY_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

-- Thay trigger hiện hành để lỗi DB không lộ thông điệp tiếng Anh hoặc chi tiết SQL
-- DETAIL giữ mã rule ổn định để adapter ánh xạ sang code lỗi API
DROP TRIGGER "criterion_scores_rules_check" ON "criterion_scores";
DROP FUNCTION "check_criterion_score_rules"();
CREATE FUNCTION "check_criterion_score_rules"() RETURNS trigger AS $$
DECLARE
  ev_period_id uuid;
  ev_status varchar;
  ev_deadline timestamp;
  ev_start timestamp;
  ev_published_at timestamp;
  cr_period_id uuid;
  cr_max_score decimal;
  self_changed boolean;
  supplement_changed boolean;
  rule_code varchar;
BEGIN
  SELECT e."period_id", e."status", e."supplement_start_at", e."supplement_deadline", p."published_at"
    INTO ev_period_id, ev_status, ev_start, ev_deadline, ev_published_at
  FROM "evaluations" e JOIN "evaluation_periods" p ON p."id" = e."period_id"
  WHERE e."id" = NEW."evaluation_id";
  SELECT "period_id", "max_score" INTO cr_period_id, cr_max_score
  FROM "criteria" WHERE "id" = NEW."criterion_id";

  IF ev_period_id IS DISTINCT FROM cr_period_id THEN
    rule_code := 'SCORE_PERIOD_MISMATCH';
    RAISE EXCEPTION 'Tiêu chí chấm điểm không thuộc cùng đợt thi đua với hồ sơ'
      USING ERRCODE = '23514', DETAIL = rule_code;
  END IF;
  IF EXISTS (SELECT 1 FROM "criteria" WHERE "parent_id" = NEW."criterion_id") THEN
    rule_code := 'SCORE_PARENT_CRITERION';
    RAISE EXCEPTION 'Chỉ tiêu chí lá mới được phép chấm điểm'
      USING ERRCODE = '23514', DETAIL = rule_code;
  END IF;
  IF NEW."self_score" > cr_max_score OR NEW."admin_score" > cr_max_score THEN
    rule_code := 'SCORE_EXCEEDS_MAXIMUM';
    RAISE EXCEPTION 'Điểm chấm không được vượt quá điểm tối đa của tiêu chí'
      USING ERRCODE = '23514', DETAIL = rule_code;
  END IF;

  IF TG_OP = 'INSERT' THEN
    self_changed := NEW."self_score" IS NOT NULL OR NEW."self_note" IS NOT NULL;
    supplement_changed := NEW."self_score" IS NOT NULL OR NEW."self_note" IS NOT NULL;
  ELSE
    self_changed := NEW."self_score" IS DISTINCT FROM OLD."self_score"
      OR NEW."self_note" IS DISTINCT FROM OLD."self_note";
    supplement_changed := self_changed;
  END IF;

  IF self_changed AND NOT (
    ev_status = 'DRAFT' AND ev_published_at IS NOT NULL
      AND statement_timestamp() >= (SELECT "self_eval_start" FROM "evaluation_periods" WHERE "id" = ev_period_id)
      AND statement_timestamp() < (SELECT "self_eval_deadline" FROM "evaluation_periods" WHERE "id" = ev_period_id)
    OR ev_status = 'SUPPLEMENT_REQUESTED' AND NEW."needs_supplement"
      AND ev_start IS NOT NULL AND statement_timestamp() >= ev_start
      AND ev_deadline IS NOT NULL AND statement_timestamp() < ev_deadline
  ) THEN
    rule_code := 'SELF_EVALUATION_WINDOW_CLOSED';
    RAISE EXCEPTION 'Đã hết thời gian được phép chỉnh sửa nội dung tự đánh giá'
      USING ERRCODE = '23514', DETAIL = rule_code;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."self_score" IS DISTINCT FROM OLD."self_score"
     AND NEW."admin_score" IS NOT DISTINCT FROM OLD."admin_score" THEN
    NEW."admin_score" := NULL;
    NEW."reviewed_by_id" := NULL;
    NEW."reviewed_at" := NULL;
  END IF;
  IF supplement_changed AND ev_status = 'SUPPLEMENT_REQUESTED' THEN
    NEW."supplemented_at" := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "criterion_scores_rules_check"
  BEFORE INSERT OR UPDATE OF "evaluation_id", "criterion_id", "self_score", "self_note", "admin_score", "needs_supplement"
  ON "criterion_scores" FOR EACH ROW EXECUTE FUNCTION "check_criterion_score_rules"();

-- Bảo vệ minh chứng theo cùng snapshot thời gian với điểm và chỉ cho phép round đúng cửa sổ
DROP TRIGGER "evidences_edit_check" ON "evidences";
DROP TRIGGER "evidences_delete_check" ON "evidences";
DROP FUNCTION "check_evidence_edit_rules"();
CREATE FUNCTION "check_evidence_edit_rules"() RETURNS trigger AS $$
DECLARE
  rec "evidences"%ROWTYPE;
  ev_status varchar;
  ev_start timestamp;
  ev_deadline timestamp;
  ev_published_at timestamp;
  self_start timestamp;
  self_deadline timestamp;
  is_flagged boolean;
  rule_code varchar;
BEGIN
  IF TG_OP = 'DELETE' THEN rec := OLD; ELSE rec := NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW."criterion_score_id" IS DISTINCT FROM OLD."criterion_score_id" THEN
    rule_code := 'EVIDENCE_SCORE_IMMUTABLE';
    RAISE EXCEPTION 'Không được chuyển minh chứng sang tiêu chí chấm điểm khác'
      USING ERRCODE = '23514', DETAIL = rule_code;
  END IF;
  SELECT e."status", e."supplement_start_at", e."supplement_deadline", p."published_at",
         p."self_eval_start", p."self_eval_deadline", cs."needs_supplement"
    INTO ev_status, ev_start, ev_deadline, ev_published_at, self_start, self_deadline, is_flagged
  FROM "criterion_scores" cs JOIN "evaluations" e ON e."id" = cs."evaluation_id"
  JOIN "evaluation_periods" p ON p."id" = e."period_id"
  WHERE cs."id" = rec."criterion_score_id";

  IF ev_status = 'DRAFT' AND ev_published_at IS NOT NULL
     AND statement_timestamp() >= self_start AND statement_timestamp() < self_deadline THEN
    IF TG_OP <> 'DELETE' AND NEW."round" <> 'INITIAL' THEN
      rule_code := 'EVIDENCE_ROUND_INVALID';
      RAISE EXCEPTION 'Minh chứng trong đợt tự đánh giá phải thuộc lượt INITIAL'
        USING ERRCODE = '23514', DETAIL = rule_code;
    END IF;
  ELSIF ev_status = 'SUPPLEMENT_REQUESTED' AND is_flagged
     AND ev_start IS NOT NULL AND statement_timestamp() >= ev_start
     AND ev_deadline IS NOT NULL AND statement_timestamp() < ev_deadline THEN
    IF TG_OP = 'UPDATE' AND OLD."round" <> 'SUPPLEMENT' OR TG_OP = 'DELETE' AND OLD."round" <> 'SUPPLEMENT' THEN
      rule_code := 'INITIAL_EVIDENCE_LOCKED';
      RAISE EXCEPTION 'Minh chứng lượt INITIAL không được sửa trong thời gian bổ sung'
        USING ERRCODE = '23514', DETAIL = rule_code;
    END IF;
    IF TG_OP <> 'DELETE' AND NEW."round" <> 'SUPPLEMENT' THEN
      rule_code := 'EVIDENCE_ROUND_INVALID';
      RAISE EXCEPTION 'Minh chứng trong thời gian bổ sung phải thuộc lượt SUPPLEMENT'
        USING ERRCODE = '23514', DETAIL = rule_code;
    END IF;
  ELSE
    rule_code := 'EVIDENCE_EDIT_WINDOW_CLOSED';
    RAISE EXCEPTION 'Đã hết thời gian được phép chỉnh sửa minh chứng'
      USING ERRCODE = '23514', DETAIL = rule_code;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "evidences_edit_check"
  BEFORE INSERT OR UPDATE OF "criterion_score_id", "kind", "round", "file_name", "mime_type", "size_bytes", "storage_path", "external_url", "description"
  ON "evidences" FOR EACH ROW EXECUTE FUNCTION "check_evidence_edit_rules"();
CREATE TRIGGER "evidences_delete_check"
  BEFORE DELETE ON "evidences" FOR EACH ROW EXECUTE FUNCTION "check_evidence_edit_rules"();

-- Ghi mốc supplementedAt chỉ khi nội dung minh chứng thật sự được tạo hoặc thay đổi trong lượt bổ sung
CREATE FUNCTION "mark_score_supplemented"() RETURNS trigger AS $$
BEGIN
  UPDATE "criterion_scores" cs SET "supplemented_at" = statement_timestamp()
  FROM "evaluations" e
  WHERE cs."id" = NEW."criterion_score_id" AND e."id" = cs."evaluation_id"
    AND e."status" = 'SUPPLEMENT_REQUESTED';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "evidences_mark_supplemented_insert"
  AFTER INSERT ON "evidences" FOR EACH ROW WHEN (NEW."round" = 'SUPPLEMENT')
  EXECUTE FUNCTION "mark_score_supplemented"();
CREATE TRIGGER "evidences_mark_supplemented_update"
  AFTER UPDATE OF "kind", "round", "file_name", "mime_type", "size_bytes", "storage_path", "external_url", "description"
  ON "evidences" FOR EACH ROW WHEN (
    NEW."round" = 'SUPPLEMENT' AND (
      NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."round" IS DISTINCT FROM OLD."round"
      OR NEW."file_name" IS DISTINCT FROM OLD."file_name" OR NEW."mime_type" IS DISTINCT FROM OLD."mime_type"
      OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes" OR NEW."storage_path" IS DISTINCT FROM OLD."storage_path"
      OR NEW."external_url" IS DISTINCT FROM OLD."external_url" OR NEW."description" IS DISTINCT FROM OLD."description"
    )
  )
  EXECUTE FUNCTION "mark_score_supplemented"();

-- Các khóa ngoại và CHECK của bảng mới chặn xóa dây chuyền, lease sai và trạng thái xác nhận thiếu kết quả
-- Múi giờ UTC được cấu hình cho từng kết nối ứng dụng để timestamp không timezone round-trip nhất quán
COMMIT;
