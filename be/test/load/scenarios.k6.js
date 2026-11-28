import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Rate } from "k6/metrics";
import exec from "k6/execution";

const fixturePath = __ENV.FIXTURE_PATH || "../../.tmp/load-test/users.json";
const units = new SharedArray("unit-identities", () => JSON.parse(open(fixturePath)).units);
const admins = new SharedArray("admin-identities", () => JSON.parse(open(fixturePath)).admins);
const [config] = new SharedArray("metadata", () => { const data = JSON.parse(open(fixturePath)); delete data.units; delete data.admins; return [data]; });
const mode = __ENV.SCENARIO || "browse";
const base = __ENV.BASE_URL || config.baseUrl;
const target = Number(__ENV.TARGET_VUS || 1000);
const adminCount = Number(__ENV.ADMIN_VUS || 20);
const duration = __ENV.HOLD_DURATION || "30m";
const errors = new Rate("scenario_errors");
const scriptErrors = new Counter("script_errors");
const completed = mode === "deadline" ? new Counter("completed_evaluations") : null;
if (base !== config.baseUrl || !Number.isInteger(target) || target < 1 || target > units.length) throw new Error("Kiểm lại BASE_URL và TARGET_VUS trong fixture staging");
if (!["browse", "deadline", "review"].includes(mode)) throw new Error("SCENARIO phải là browse, deadline hoặc review");
if (mode === "review" && (config.mode !== "review" || !Number.isInteger(adminCount) || adminCount < 1 || adminCount > admins.length)) throw new Error("Review cần fixture LOAD_TEST_MODE=review và đủ ADMIN_VUS");
if (mode === "deadline" && !["deadline", "mixed"].includes(config.mode)) throw new Error("Deadline cần fixture DRAFT mới");

const stages = (total) => [{ duration: __ENV.RAMP_DURATION || "2m", target: total }, { duration, target: total }, { duration: __ENV.RAMP_DOWN_DURATION || "30s", target: 0 }];
const readers = { executor: "ramping-vus", exec: "browse", startVUs: 0, stages: stages(target), gracefulRampDown: "15s" };
const thresholds = { scenario_errors: ["rate<0.01"], script_errors: ["count==0"], http_req_failed: ["rate<0.01"], "http_req_duration{operation:read}": ["p(95)<1000"], checks: ["rate>0.99"] };
if (mode !== "browse") thresholds["http_req_duration{operation:write}"] = ["p(95)<2000"];
if (mode === "deadline") thresholds.completed_evaluations = [`count>=${target}`];
export const options = {
  scenarios: mode === "deadline"
    ? { deadline: { executor: "per-vu-iterations", exec: "deadline", vus: target, iterations: 1, maxDuration: "5m" } }
    // Một executor giữ một dải ID ổn định: ADMIN trước, UNIT sau; không chia sẻ pool ID giữa hai scenario.
    : mode === "review" ? { review_with_browse: { ...readers, exec: "reviewAndBrowse", stages: stages(target + adminCount) } } : { browse: readers },
  thresholds,
};

function request(method, path, token, body, operation, name) {
  const response = http.request(method, `${base}/api/v1/${path}`, body === undefined ? null : JSON.stringify(body), {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: "30s", tags: { operation, name },
  });
  const ok = check(response, { "API thành công": (value) => value.status >= 200 && value.status < 300 });
  errors.add(!ok);
  return response;
}

export function setup() {
  scriptErrors.add(0);
  if (completed) completed.add(0);
  if (Date.parse(config.expiresAt) - Date.now() < 40 * 60000) throw new Error("Fixture còn dưới 40 phút; tạo fixture mới trước bài đo");
  const response = request("GET", "auth/me", units[0].token, undefined, "read", "preflight");
  if (response.status !== 200) throw new Error("Backend/JWT/fixture chưa sẵn sàng");
}

export function browse() {
  safely(() => browseUser(units[exec.vu.idInTest - 1]));
}

function browseUser(user) {
  if (!user) throw new Error("VU không có danh tính riêng");
  request("GET", `evaluation-periods?pageSize=100`, user.token, undefined, "read", "period_list");
  request("GET", `evaluations?periodId=${config.periodId}&pageSize=1`, user.token, undefined, "read", "record_list");
  request("GET", `evaluations/${user.evaluationId}`, user.token, undefined, "read", "evaluation_detail");
  request("GET", "notifications/unread-count", user.token, undefined, "read", "notifications_unread");
  sleep(Number(__ENV.THINK_SECONDS || 30) * (0.8 + Math.random() * 0.4));
}

export function deadline() {
  safely(runDeadline);
}

function runDeadline() {
  const user = units[exec.vu.idInTest - 1];
  sleep(Math.random() * Number(__ENV.SPREAD_SECONDS || 240));
  const items = config.criteria.map((leaf) => ({ criterionId: leaf.id, selfScore: leaf.maxScore, selfNote: `LOAD:${config.runId}:${user.unitId}:deadline` }));
  const saved = request("PUT", `evaluations/${user.evaluationId}/scores/self-batch`, user.token, { items }, "write", "save_all_scores");
  let success = false;
  try { success = saved.status === 200 && saved.json("results").length === items.length && saved.json("results").every((item) => item.ok); } catch { /* record failure below */ }
  errors.add(!success);
  check(success, { "Mọi ô được lưu": (value) => value });
  if (success) {
    const submitted = request("POST", `evaluations/${user.evaluationId}/submit`, user.token, {}, "write", "submit_evaluation");
    if (submitted.status >= 200 && submitted.status < 300) completed.add(1);
  }
}

export function reviewAndBrowse() {
  safely(() => {
    const index = exec.vu.idInTest - 1;
    if (index < adminCount) review(index);
    else browseUser(units[index - adminCount]);
  });
}

function review(index) {
  const admin = admins[index];
  const user = units[(index + exec.vu.iterationInScenario * adminCount) % units.length];
  request("POST", `admin/evaluations/${user.evaluationId}/accept-all`, admin.token, {}, "write", "accept_all_scores");
  request("POST", `admin/evaluations/${user.evaluationId}/first-review-complete`, admin.token, {}, "write", "complete_first_review");
  sleep(5 + Math.random() * 5);
}

function safely(work) {
  try { work(); }
  catch {
    scriptErrors.add(1);
    exec.test.abort("Lỗi script k6: kiểm tra fixture và ánh xạ danh tính theo VU.");
  }
}
