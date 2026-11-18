BEGIN;

-- Bảo vệ lần nộp INITIAL tại đúng statement ghi, bổ sung cho kiểm quyền và khóa ở service
-- NEW là snapshot hồ sơ sắp đổi, OLD là bản đã khóa; chỉ nhánh tạo submitted_at mới cần kiểm lịch
-- Auto-lock giữ submitted_at rỗng và không bắt minh chứng, retry giữ timestamp cũ không tạo lần nộp mới
-- Dùng giờ UTC của statement thay giờ mở transaction để request chờ khóa qua deadline bị từ chối
CREATE FUNCTION "check_initial_submission_window"() RETURNS trigger AS $$
DECLARE
  period_record "evaluation_periods"%ROWTYPE;
BEGIN
  IF NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at" THEN
    SELECT * INTO period_record FROM "evaluation_periods" WHERE "id" = NEW."period_id";
    IF OLD."status" <> 'DRAFT' OR NEW."status" <> 'PENDING_REVIEW'
       OR NEW."submitted_at" IS NULL OR period_record."published_at" IS NULL
       OR period_record."phase" NOT IN ('SETUP', 'SELF_EVAL')
       OR period_record."self_eval_start" IS NULL OR period_record."self_eval_deadline" IS NULL
       OR (statement_timestamp() AT TIME ZONE 'UTC') < period_record."self_eval_start"
       OR (statement_timestamp() AT TIME ZONE 'UTC') >= period_record."self_eval_deadline" THEN
      RAISE EXCEPTION 'Hồ sơ không còn trong thời gian được phép nộp tự chấm'
        USING ERRCODE = '23514', DETAIL = 'INITIAL_SUBMISSION_WINDOW_CLOSED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Không viết lại migration đã áp dụng, trigger mới chỉ tác động thao tác nộp phát sinh sau nâng cấp
CREATE TRIGGER "evaluations_initial_submission_check"
  BEFORE UPDATE OF "submitted_at", "status" ON "evaluations"
  FOR EACH ROW EXECUTE FUNCTION "check_initial_submission_window"();

COMMIT;
