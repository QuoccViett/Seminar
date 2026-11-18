BEGIN;

-- Thêm baseline riêng cho vòng bổ sung, không đổi điểm hay minh chứng của dữ liệu đã có
-- JSON chỉ gồm nội dung công khai và thông tin duyệt, không lưu key kho tệp hoặc secret
ALTER TABLE "criterion_scores" ADD COLUMN "supplement_baseline" jsonb;

-- Chụp nội dung hiện tại cho vòng đang mở khi nâng cấp, vì không thể đoán lịch sử thiếu
-- Hồ sơ phải có thay đổi mới so với baseline này trước khi nộp, giữ nguyên mọi trường cũ
UPDATE "criterion_scores" cs SET "supplement_baseline" = jsonb_build_object(
  'content', jsonb_build_object('selfScore', cs.self_score::text, 'selfNote', cs.self_note,
    'evidenceIds', COALESCE((SELECT jsonb_agg(ev.id::text ORDER BY ev.id) FROM evidences ev WHERE ev.criterion_score_id = cs.id), '[]'::jsonb)),
  'review', jsonb_build_object('adminScore', cs.admin_score::text, 'adminComment', cs.admin_comment,
    'reviewedById', cs.reviewed_by_id, 'reviewedAt', cs.reviewed_at),
  'capturedAt', statement_timestamp() AT TIME ZONE 'UTC', 'source', 'MIGRATION'
)
FROM "evaluations" e WHERE e.id = cs.evaluation_id AND e.status = 'SUPPLEMENT_REQUESTED' AND cs.needs_supplement;

-- So sánh điểm bằng numeric, diễn giải null an toàn và tập ID minh chứng đã xác nhận
-- ID của minh chứng gắn nội dung bất biến qua API, reservation chưa xác nhận không được tính
-- Baseline thiếu trả false để không coi updated_at hoặc thao tác gắn cờ là thay đổi thật
CREATE FUNCTION "fn_vc12_supplement_changed"(p_score_id uuid) RETURNS boolean AS $$
  SELECT cs.supplement_baseline IS NOT NULL AND (
    cs.self_score IS DISTINCT FROM (cs.supplement_baseline->'content'->>'selfScore')::numeric
    OR cs.self_note IS DISTINCT FROM (cs.supplement_baseline->'content'->>'selfNote')
    OR COALESCE((SELECT jsonb_agg(ev.id::text ORDER BY ev.id) FROM evidences ev WHERE ev.criterion_score_id = cs.id), '[]'::jsonb)
       IS DISTINCT FROM cs.supplement_baseline->'content'->'evidenceIds'
  ) FROM criterion_scores cs WHERE cs.id = p_score_id;
$$ LANGUAGE sql STABLE;

-- Baseline của vòng đã gửi là bất biến để việc sửa dữ liệu không tự làm mất lịch sử
-- Caller chỉ tạo baseline khi yêu cầu lần đầu, migration đã backfill trước khi bật trigger
CREATE FUNCTION "check_vc12_baseline_immutable"() RETURNS trigger AS $$
BEGIN
  IF OLD.supplement_baseline IS NOT NULL AND NEW.supplement_baseline IS DISTINCT FROM OLD.supplement_baseline THEN
    RAISE EXCEPTION 'Không được thay đổi snapshot của vòng bổ sung đã tạo' USING ERRCODE = '23514', DETAIL = 'SUPPLEMENT_BASELINE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "vc12_baseline_immutable" BEFORE UPDATE OF supplement_baseline ON criterion_scores
  FOR EACH ROW EXECUTE FUNCTION check_vc12_baseline_immutable();

-- Kiểm giờ tại statement trước trigger cũ, mã SQLSTATE riêng chỉ ánh xạ thành lỗi công khai cố định
-- Thay điểm hoặc diễn giải trong bổ sung luôn làm mất hiệu lực thẩm định cũ, kể cả chỉ đổi ghi chú
CREATE FUNCTION "check_vc12_self_change"() RETURNS trigger AS $$
DECLARE
  ev evaluations%ROWTYPE;
  phase_name varchar;
BEGIN
  IF NEW.self_score IS NOT DISTINCT FROM OLD.self_score AND NEW.self_note IS NOT DISTINCT FROM OLD.self_note THEN RETURN NEW; END IF;
  SELECT * INTO ev FROM evaluations WHERE id = NEW.evaluation_id;
  IF ev.status IN ('SUPPLEMENT_REQUESTED', 'SUPPLEMENT_EXPIRED') THEN
    IF ev.supplement_deadline IS NOT NULL AND (statement_timestamp() AT TIME ZONE 'UTC') >= ev.supplement_deadline THEN
      RAISE EXCEPTION 'Đã hết thời gian bổ sung hồ sơ' USING ERRCODE = 'P4012';
    END IF;
    SELECT phase INTO phase_name FROM evaluation_periods WHERE id = ev.period_id;
    IF phase_name NOT IN ('FIRST_REVIEW', 'SUPPLEMENT') THEN
      RAISE EXCEPTION 'Giai đoạn kỳ không cho phép bổ sung hồ sơ' USING ERRCODE = '23514', DETAIL = 'SUPPLEMENT_PHASE_LOCKED';
    END IF;
    NEW.admin_score := NULL; NEW.admin_comment := NULL; NEW.reviewed_by_id := NULL; NEW.reviewed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "a_vc12_self_change" BEFORE UPDATE OF self_score, self_note ON criterion_scores
  FOR EACH ROW EXECUTE FUNCTION check_vc12_self_change();

-- Chặn minh chứng sát hạn trước các trigger kiểm round và phase đã có
-- Dùng OLD khi xóa và NEW khi thêm/sửa, không áp dụng cho các trường preview do worker cập nhật
CREATE FUNCTION "check_vc12_evidence_deadline"() RETURNS trigger AS $$
DECLARE score_id uuid; ev evaluations%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN score_id := OLD.criterion_score_id; ELSE score_id := NEW.criterion_score_id; END IF;
  SELECT e.* INTO ev FROM evaluations e JOIN criterion_scores cs ON cs.evaluation_id = e.id WHERE cs.id = score_id;
  IF ev.status IN ('SUPPLEMENT_REQUESTED', 'SUPPLEMENT_EXPIRED') AND ev.supplement_deadline IS NOT NULL
     AND (statement_timestamp() AT TIME ZONE 'UTC') >= ev.supplement_deadline THEN
    RAISE EXCEPTION 'Đã hết thời gian bổ sung hồ sơ' USING ERRCODE = 'P4012';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "a_vc12_evidence_deadline" BEFORE INSERT OR DELETE OR UPDATE OF
  criterion_score_id, kind, round, file_name, mime_type, size_bytes, storage_path, external_url, description
  ON evidences FOR EACH ROW EXECUTE FUNCTION check_vc12_evidence_deadline();

-- Thay đổi tập minh chứng bổ sung làm điểm duyệt cũ không còn hiệu lực
-- Mốc thao tác vẫn được ghi khi xóa nhưng điều kiện nộp dùng so sánh baseline nên thêm rồi xóa không đủ
CREATE FUNCTION "invalidate_vc12_evidence_review"() RETURNS trigger AS $$
DECLARE score_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN score_id := OLD.criterion_score_id; ELSE score_id := NEW.criterion_score_id; END IF;
  UPDATE criterion_scores cs SET admin_score = NULL, admin_comment = NULL, reviewed_by_id = NULL,
    reviewed_at = NULL, supplemented_at = statement_timestamp() AT TIME ZONE 'UTC'
  FROM evaluations e WHERE e.id = cs.evaluation_id AND cs.id = score_id AND e.status = 'SUPPLEMENT_REQUESTED';
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "vc12_evidence_review_insert" AFTER INSERT ON evidences FOR EACH ROW WHEN (NEW.round = 'SUPPLEMENT') EXECUTE FUNCTION invalidate_vc12_evidence_review();
CREATE TRIGGER "vc12_evidence_review_delete" AFTER DELETE ON evidences FOR EACH ROW WHEN (OLD.round = 'SUPPLEMENT') EXECUTE FUNCTION invalidate_vc12_evidence_review();

-- Khóa nộp tại đúng câu UPDATE trạng thái, không phụ thuộc khoảng cách giữa lần kiểm service và lúc ghi
-- Mọi lá yêu cầu phải có nội dung cuối khác baseline, cờ supplemented_at riêng lẻ không cấp quyền nộp
-- Retry giữ nguyên thời điểm nộp không bị trigger xem là một lần nộp mới
CREATE FUNCTION "check_vc12_supplement_submission"() RETURNS trigger AS $$
DECLARE phase_name varchar;
BEGIN
  IF NEW.supplement_submitted_at IS DISTINCT FROM OLD.supplement_submitted_at THEN
    IF OLD.supplement_deadline IS NOT NULL AND (statement_timestamp() AT TIME ZONE 'UTC') >= OLD.supplement_deadline THEN
      RAISE EXCEPTION 'Đã hết thời gian nộp nội dung bổ sung' USING ERRCODE = 'P4012';
    END IF;
    SELECT phase INTO phase_name FROM evaluation_periods WHERE id = OLD.period_id;
    IF OLD.status <> 'SUPPLEMENT_REQUESTED' OR NEW.status <> 'SUPPLEMENT_SUBMITTED'
       OR NEW.supplement_submitted_at IS NULL OR OLD.supplement_start_at IS NULL
       OR (statement_timestamp() AT TIME ZONE 'UTC') < OLD.supplement_start_at
       OR phase_name NOT IN ('FIRST_REVIEW', 'SUPPLEMENT') THEN
      RAISE EXCEPTION 'Hồ sơ không còn trong thời gian được phép nộp bổ sung' USING ERRCODE = '23514', DETAIL = 'SUPPLEMENT_SUBMISSION_LOCKED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM criterion_scores WHERE evaluation_id = OLD.id AND needs_supplement)
       OR EXISTS (SELECT 1 FROM criterion_scores WHERE evaluation_id = OLD.id AND needs_supplement AND NOT COALESCE(fn_vc12_supplement_changed(id), false)) THEN
      RAISE EXCEPTION 'Cần bổ sung nội dung thực tế cho từng tiêu chí được yêu cầu' USING ERRCODE = '23514', DETAIL = 'INCOMPLETE_SUPPLEMENT';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "a_vc12_supplement_submission" BEFORE UPDATE OF status, supplement_submitted_at ON evaluations
  FOR EACH ROW EXECUTE FUNCTION check_vc12_supplement_submission();

COMMIT;
