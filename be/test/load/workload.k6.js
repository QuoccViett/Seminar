import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Rate } from "k6/metrics";
import exec from "k6/execution";

const fixturePath = __ENV.FIXTURE_PATH || "../../.tmp/load-test/users.json";
const users = new SharedArray("users", () => JSON.parse(open(fixturePath)).units);
const config = new SharedArray("config", () => {
  const metadata = JSON.parse(open(fixturePath));
  delete metadata.units;
  return [metadata];
})[0];
const baseUrl = __ENV.BASE_URL || config.baseUrl;
const target = Number(__ENV.TARGET_VUS || 1000);
if (!Number.isInteger(target) || target < 1 || target > users.length) throw new Error("TARGET_VUS vượt số danh tính test hoặc không hợp lệ");
if (baseUrl !== config.baseUrl) throw new Error("BASE_URL phải trùng backend local trong fixture");
const failures = new Rate("workload_errors");
const ramp = __ENV.RAMP_DURATION || "30s";
const stage = (ratio) => ({ duration: ramp, target: Math.max(1, Math.ceil(target * ratio)) });

export const options = {
  systemTags: ["status", "method", "name", "scenario", "check", "error", "error_code", "expected_response"],
  scenarios: { workload: { executor: "ramping-vus", startVUs: 0, stages: [stage(0.1), stage(0.25), stage(0.5), stage(1), { duration: __ENV.HOLD_DURATION || "3m", target }, { duration: ramp, target: 0 }], gracefulRampDown: "15s" } },
  thresholds: {
    workload_errors: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
    "http_req_duration{operation:read}": ["p(95)<800"],
    "http_req_duration{operation:write}": ["p(95)<1500"],
    checks: ["rate>0.99"],
  },
};

/** Kiểm cấu hình/phiên bằng một request trước khi khởi động toàn bộ tải. */
export function setup() {
  if (Date.parse(config.expiresAt) - Date.now() < 15 * 60_000) throw new Error("Fixture gần hết hạn; cần tạo lượt mới trước bài đo");
  const result = http.get(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${users[0].token}` }, tags: { name: "preflight" } });
  if (result.status !== 200) throw new Error("Backend test chưa sẵn sàng hoặc JWT_SECRET/fixture không khớp");
}

/** 1 VU = 1 tài khoản riêng, 80% đọc / 20% lưu, nghỉ 1–3 giây giữa thao tác. */
export default function () {
  const user = users[exec.vu.idInTest - 1];
  const headers = { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" };
  const path = `${baseUrl}/api/v1/evaluations/${user.evaluationId}`;
  const choice = Math.random();
  let result;
  if (choice < 0.2) {
    const score = 1 + exec.vu.iterationInScenario % 60;
    result = http.put(`${path}/scores/${config.criterionId}/self`, JSON.stringify({ selfScore: score, selfNote: `LOAD:${config.runId}:${user.unitId}:${exec.vu.iterationInScenario}` }), { headers, timeout: "10s", tags: { name: "save_score", operation: "write" } });
  } else {
    const [url, name] = choice < 0.6 ? [path, "evaluation_detail"] : choice < 0.85 ? [`${path}/score-summary`, "score_summary"] : [`${baseUrl}/api/v1/notifications/unread-count`, "notifications_unread"];
    result = http.get(url, { headers, timeout: "10s", tags: { name, operation: "read" } });
  }
  const ok = check(result, { "HTTP 200 và JSON hợp lệ": (response) => {
    if (response.status !== 200) return false;
    try { return response.json() !== null; } catch { return false; }
  } });
  failures.add(!ok);
  sleep(1 + Math.random() * 2);
}
