BEGIN;

-- Lưu riêng lượt tải chưa xác nhận để không biến bytes chưa kiểm thành minh chứng
-- Khóa ngoại NoAction giữ lịch sử, hai key unique do server cấp tránh ghi đè giữa các hồ sơ
-- Không backfill hoặc đổi Evidence cũ, chỉ lượt tải mới chịu giới hạn kích thước và trạng thái
CREATE TABLE "evidence_uploads" (
  "id" uuid PRIMARY KEY,
  "criterion_score_id" uuid NOT NULL REFERENCES "criterion_scores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  "uploader_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  "credential_version" integer NOT NULL,
  "round" varchar NOT NULL CHECK ("round" IN ('INITIAL', 'SUPPLEMENT')),
  "file_name" varchar(180) NOT NULL,
  "mime_type" varchar NOT NULL,
  "size_bytes" bigint NOT NULL CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760),
  "pending_path" varchar NOT NULL UNIQUE,
  "final_path" varchar NOT NULL UNIQUE,
  "state" varchar NOT NULL DEFAULT 'PENDING' CHECK ("state" IN ('PENDING', 'CONFIRMED', 'DELETING')),
  "pending_purged" boolean NOT NULL DEFAULT false,
  "expires_at" timestamp(6) NOT NULL,
  "created_at" timestamp(6) NOT NULL,
  CONSTRAINT "evidence_upload_expiry_check" CHECK ("expires_at" > "created_at")
);
CREATE INDEX "evidence_uploads_state_expires_at_idx" ON "evidence_uploads"("state", "expires_at");
CREATE INDEX "evidence_uploads_criterion_score_id_idx" ON "evidence_uploads"("criterion_score_id");

-- Bổ sung kiểm phase tại statement ghi để DB và policy cùng từ chối kỳ đã tiến xa
-- Trigger cũ vẫn kiểm round, cửa sổ, tiêu chí được yêu cầu và bảo vệ INITIAL trong bổ sung
-- Hàm nhận NEW hoặc OLD theo thao tác, không phụ thuộc đồng hồ client hoặc lịch supplementHours
CREATE FUNCTION "check_evidence_phase"() RETURNS trigger AS $$
DECLARE
  score_id uuid;
  ev_status varchar;
  ev_phase varchar;
BEGIN
  IF TG_OP = 'DELETE' THEN score_id := OLD.criterion_score_id; ELSE score_id := NEW.criterion_score_id; END IF;
  SELECT e.status, p.phase INTO ev_status, ev_phase
    FROM criterion_scores cs JOIN evaluations e ON e.id = cs.evaluation_id
    JOIN evaluation_periods p ON p.id = e.period_id WHERE cs.id = score_id;
  IF (ev_status = 'DRAFT' AND ev_phase NOT IN ('SETUP', 'SELF_EVAL'))
     OR (ev_status = 'SUPPLEMENT_REQUESTED' AND ev_phase NOT IN ('FIRST_REVIEW', 'SUPPLEMENT')) THEN
    RAISE EXCEPTION 'Giai đoạn kỳ không cho phép chỉnh sửa minh chứng'
      USING ERRCODE = '23514', DETAIL = 'EVIDENCE_PHASE_LOCKED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "evidences_phase_check" BEFORE INSERT OR DELETE OR UPDATE OF
  "criterion_score_id", "kind", "round", "file_name", "mime_type", "size_bytes", "storage_path", "external_url", "description"
  ON "evidences" FOR EACH ROW EXECUTE FUNCTION "check_evidence_phase"();

COMMIT;
