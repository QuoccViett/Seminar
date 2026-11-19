import assert from "node:assert/strict";
import { test } from "node:test";
import type { Evaluation, EvaluationPeriod } from "../../generated/prisma/client.js";
import { selfLockedReason } from "./evaluation-policy.js";
import { reviewPermissions } from "./review-policy.js";

/** Đối chiếu bảng quyền trong contract trên tích phase × status × giờ × công bố × mục yêu cầu
 * Các cặp được phép được liệt kê độc lập thay vì gọi helper khác để tự tạo đáp án
 * Mốc thứ Sáu gồm trọn phút 23:59 và deadline 00:00 loại trừ theo giờ Việt Nam
 * Vai trò và sở hữu được kiểm HTTP trên danh mục mọi route ID tại bộ VC17 hệ thống
 */
test("VC17 ma trận policy 864 tổ hợp không mở lại quyền tại biên giờ hoặc trạng thái đã khóa", () => {
  const start = new Date("2026-11-20T00:00:00Z"); const deadline = new Date("2026-11-20T17:00:00Z");
  const instants = [new Date(+start - 1), start, new Date("2026-11-20T16:59:00Z"), new Date(+deadline - 1), deadline, new Date(+deadline + 1)];
  const initial = new Set(["SETUP/DRAFT", "SELF_EVAL/DRAFT"]);
  const supplement = new Set(["FIRST_REVIEW/SUPPLEMENT_REQUESTED", "SUPPLEMENT/SUPPLEMENT_REQUESTED"]);
  let checked = 0;
  for (const phase of ["SETUP", "SELF_EVAL", "FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW", "CLOSED"]) {
    for (const status of ["DRAFT", "PENDING_REVIEW", "SUPPLEMENT_REQUESTED", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED", "FINALIZED"]) {
      for (const now of instants) for (const published of [false, true]) for (const requested of [false, true]) {
        const period = { phase, publishedAt: published ? start : null, selfEvalStart: start, selfEvalDeadline: deadline } as EvaluationPeriod;
        const evaluation = { status, firstReviewedAt: start, supplementRequestedAt: start, supplementStartAt: start, supplementDeadline: deadline } as Evaluation;
        const inside = now >= start && now < deadline;
        const expected = published && inside && (initial.has(`${phase}/${status}`) || (requested && supplement.has(`${phase}/${status}`)));
        const reason = selfLockedReason(period, evaluation, now, requested);
        assert.equal(reason === null, expected, `${phase}/${status}/${now.toISOString()}/${published}/${requested}`);
        if (reason) assert.match(reason, /[À-ỹ]/u);
        if (!published) assert.equal(reviewPermissions(period, evaluation, now).canReview, false);
        checked++;
      }
    }
  }
  assert.equal(checked, 864);
});

/** Lịch thiếu không được coi là đang mở dù trạng thái DB và tiêu chí yêu cầu trông hợp lệ
 * Kiểm cả start thiếu và deadline thiếu cho INITIAL/SUPPLEMENT để tránh cấp quyền từ giá trị mặc định
 */
test("VC17 policy khóa an toàn khi snapshot lịch thiếu hoặc hồ sơ đã tự khóa", () => {
  const now = new Date("2026-11-20T01:00:00Z");
  const period = { phase: "SELF_EVAL", publishedAt: now, selfEvalStart: now, selfEvalDeadline: new Date(+now + 60000) } as EvaluationPeriod;
  const evaluation = { status: "DRAFT" } as Evaluation;
  for (const field of ["selfEvalStart", "selfEvalDeadline"] as const) assert.ok(selfLockedReason({ ...period, [field]: null }, evaluation, now));
  const supplement = { status: "SUPPLEMENT_REQUESTED", supplementStartAt: now, supplementDeadline: new Date(+now + 60000) } as Evaluation;
  for (const field of ["supplementStartAt", "supplementDeadline"] as const) assert.ok(selfLockedReason({ ...period, phase: "SUPPLEMENT" }, { ...supplement, [field]: null }, now, true));
  assert.match(selfLockedReason(period, { status: "PENDING_REVIEW", autoLockedAt: now } as Evaluation, now)!, /hết thời gian/u);
});
