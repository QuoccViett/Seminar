import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { setTimeout } from "node:timers";
import { resolve } from "node:path";
import process from "node:process";
import pg from "pg";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = resolve(root, ".tmp/vc17-artifacts");
const suites = [
  ["vc03", "vc03_test", "VC03_TEST_DATABASE_URL", ["vc03.database", "vc03.auth"]],
  ["vc04", "vc04_test", "VC04_TEST_DATABASE_URL", ["vc04.management"]],
  ["vc05", "vc05_test_vc17", "VC05_TEST_DATABASE_URL", ["vc05.notifications"]],
  ["vc06", "vc06_test_vc17", "VC06_TEST_DATABASE_URL", ["vc06.credential-delivery"]],
  ["vc07", "vc07_test", "VC07_TEST_DATABASE_URL", ["vc07.import"]],
  ["vc08", "vc08_test", "VC08_TEST_DATABASE_URL", ["vc08.periods"]],
  ["vc09", "vc09_test", "VC09_TEST_DATABASE_URL", ["vc09.evaluations"]],
  ["vc10", "vc10_test", "VC10_TEST_DATABASE_URL", ["vc10.evidences"]],
  ["vc11", "vc11_test", "VC11_TEST_DATABASE_URL", ["vc11.scheduler"]],
  ["recovery", "vc11_recovery_test", "VC11_TEST_DATABASE_URL", ["vc11.recovery"]],
  ["vc12", "vc12_test", "VC12_TEST_DATABASE_URL", ["vc12.review", "vc12.workflow"]],
  ["vc13", "vc13_test", "VC13_TEST_DATABASE_URL", ["vc13.feedback-audit"]],
  ["vc14", "vc14_test", "VC14_TEST_DATABASE_URL", ["vc14.dashboard"]],
  ["vc15", "vc15_test", "VC15_TEST_DATABASE_URL", ["vc15.exports"]],
  ["seed", "ci_seed", "SEED_TEST_DATABASE_URL", ["seed.integration"]],
  ["upgrade12", "vc12_upgrade_test", "VC12_UPGRADE_DATABASE_URL", ["vc12.migration"], true],
  ["upgrade13", "vc13_upgrade_test", "VC13_UPGRADE_DATABASE_URL", ["vc13.migration"], true],
  ["upgrade17", "vc17_upgrade_test", "VC17_UPGRADE_DATABASE_URL", ["vc17.migration"], true],
  ["system", "vc17_test", "VC17_TEST_DATABASE_URL", ["vc17.system"]],
  ["browser", "vc16_test", "VC16_TEST_DATABASE_URL", [], false],
];
const selected = process.env.VC17_SUITES?.split(",") ?? suites.map(([name]) => name);
const results = [];
let stage = "kiểm tra cấu hình";

/** Chạy tiến trình bằng argv riêng, tránh shell và giữ toàn bộ kết quả kiểm trong thư mục thử
 * Chỉ trả mã thoát ra console, không phản chiếu exception DB hoặc secret của tiến trình con
 * NODE_V8_COVERAGE được kế thừa cho unit và HTTP lõi, các phép thử PDF/tải/browser chạy chức năng không có profiler
 * Nhãn xác định tên log, args/env/cwd xác định lệnh và môi trường; trả về khi mã thoát bằng không và không có test bỏ qua
 * Lỗi hoặc skipped đều được ghi manifest rồi ném thông báo cố định để lượt tổng hợp không báo đạt giả
 */
async function run(label, args, env = process.env, cwd = root) {
  stage = label;
  const started = Date.now();
  // Không đo compiler/Prisma CLI và không gắn profiler vào PDF, tải hoặc browser để tránh lệch số đo và thiếu RAM
  // Toàn bộ source nghiệp vụ vẫn thuộc mẫu số c8 all=true, không loại tệp chưa được chạy khỏi ngưỡng 85 phần trăm
  // Các suite nặng vẫn phải đạt mọi assertion HTTP/DB/tệp, chỉ việc thu bộ đếm V8 được tách khỏi lượt chức năng
  const childEnv = { ...env };
  if (label === "build" || label.startsWith("migrate-") || ["vc15", "system", "browser"].includes(label)) delete childEnv.NODE_V8_COVERAGE;
  const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const code = await new Promise((resolveCode, reject) => { child.on("error", reject); child.on("close", resolveCode); });
  await writeFile(resolve(artifacts, `${label}.log`), output);
  const skipped = /# skipped ([1-9]\d*)/u.test(output);
  results.push({ stage: label, passed: code === 0 && !skipped, milliseconds: Date.now() - started, exitCode: code, skipped });
  await writeFile(resolve(artifacts, "suite-results.json"), JSON.stringify({ results, complete: false }, null, 2));
  process.stdout.write(`VC17 ${label}: ${code === 0 && !skipped ? "ĐẠT" : "CHƯA ĐẠT"}\n`);
  if (code !== 0 || skipped) throw new Error("Bộ kiểm thử chưa đạt hoặc có trường hợp bị bỏ qua");
}

/** Chờ hàm check bất đồng bộ xác nhận endpoint hoặc fixture đã sẵn sàng trong tối đa hai phút
 * Đầu vào child dùng phát hiện tiến trình chết sớm, đầu ra chỉ thành công khi check trả true
 * Lỗi kết nối lúc khởi động được thử lại, còn hết hạn hoặc tiến trình dừng thì báo lỗi tiếng Việt cố định
 */
async function ready(check, child) {
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error("Tiến trình phục vụ kiểm thử đã dừng sớm");
    try { if (await check()) return; } catch { /* Tài nguyên có thể chưa sẵn sàng trong lúc Nest hoặc Vite đang khởi động */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  throw new Error("Máy chủ kiểm thử chưa sẵn sàng trong thời hạn");
}

/** Dựng Vite cùng Nest thật, chạy trình duyệt hai vai trò và dừng đúng các tiến trình vừa tạo
 * Không nhận backend URL bên ngoài và không dùng MSW, fixture luôn ở database browser mới riêng
 * env cung cấp DB thử, origin mặc định loopback 5187, fixture tự cấp URL backend trên cổng trống
 * Chỉ hoàn tất khi script browser trả mã không, mọi tiến trình phục vụ đều được đóng trong finally kể cả khi lỗi
 */
async function browser(env) {
  const origin = process.env.VC17_FE_ORIGIN ?? "http://127.0.0.1:5187";
  if (new URL(origin).hostname !== "127.0.0.1") throw new Error("Frontend kiểm thử phải dùng loopback");
  const browserEnv = { ...env, VC16_FE_ORIGIN: origin };
  // Backend browser chạy như phiên chức năng thông thường, không cộng chi phí profiler vào timeout UI hoặc transaction
  delete browserEnv.NODE_V8_COVERAGE;
  const fixture = spawn(process.execPath, ["--import", "tsx", "test/integration/vc16.browser-fixture.ts"], { cwd: root, env: browserEnv, stdio: ["ignore", "pipe", "pipe"] });
  let frontend;
  let fixtureLog = ""; let frontendLog = "";
  fixture.stdout.on("data", (value) => { fixtureLog += value.toString(); }); fixture.stderr.on("data", (value) => { fixtureLog += value.toString(); });
  try {
    await ready(async () => fixtureLog.includes("đã sẵn sàng"), fixture);
    const state = JSON.parse(await readFile(resolve(root, ".tmp/vc16-browser-state.json"), "utf8"));
    // Backend dùng NODE_ENV=test nhưng Vite phải chạy development như npm run dev thật
    // Nếu truyền test sang FE, thư viện rc-component tạo mọi aria-labelledby thành test-id và modal mất tên truy cập
    const frontendEnv = { ...browserEnv, NODE_ENV: "development", VITE_API_URL: state.base, VITE_API_MOCKING: "disabled" };
    delete frontendEnv.NODE_V8_COVERAGE;
    frontend = spawn(process.execPath, [resolve(root, "../fe/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", new URL(origin).port, "--strictPort"], { cwd: resolve(root, "../fe"), env: frontendEnv, stdio: ["ignore", "pipe", "pipe"] });
    frontend.stdout.on("data", (value) => { frontendLog += value.toString(); }); frontend.stderr.on("data", (value) => { frontendLog += value.toString(); });
    await ready(async () => (await globalThis.fetch(origin)).ok, frontend);
    await run("browser", ["--import", "tsx", "test/browser/vc16.frontend.mjs"], browserEnv);
  } finally {
    fixture.kill("SIGINT"); frontend?.kill("SIGINT");
    await writeFile(resolve(artifacts, "browser-fixture.log"), fixtureLog);
    await writeFile(resolve(artifacts, "browser-frontend.log"), frontendLog);
  }
}

/** Chỉ tạo database mới trên PostgreSQL local được chỉ định cho VC17, tuyệt đối không DROP hoặc reset
 * Kiểm toàn bộ tên đích trước khi tạo để một lần chạy không ghi vào database demo hoặc bộ đã có dữ liệu
 * Bộ nâng cấp tự áp migration nền và giữ snapshot cũ, các bộ còn lại dùng migrate deploy từ DB trống
 * VC17_SUITES có thể chọn bộ cụ thể để chẩn đoán trên PostgreSQL mới, mặc định kiểm đầy đủ và thêm unit/ba TZ
 * Lỗi từng DB không chặn thu bằng chứng của DB độc lập khác, nhưng kết quả cuối luôn thất bại nếu còn một bộ lỗi
 */
async function main() {
  await mkdir(artifacts, { recursive: true });
  const url = new URL(process.env.VC17_ADMIN_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/vc17_control_test" || selected.some((name) => !suites.some(([key]) => key === name))) throw new Error("Cần PostgreSQL local vc17_control_test riêng và tên bộ kiểm hợp lệ");
  const admin = new pg.Client({ connectionString: url.href }); await admin.connect();
  const chosen = suites.filter(([name]) => selected.includes(name));
  const env = { ...process.env, NODE_ENV: "test", TZ: "UTC", EMAIL_ENABLED: "false", WEB_PUSH_ENABLED: "false", ZALO_ZNS_ENABLED: "false" };
  try {
    for (const [, name] of chosen) {
      const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
      if (exists.rowCount) throw new Error("Database kiểm thử đã tồn tại, cần PostgreSQL VC17 mới thay vì reset");
    }
    for (const [, name, variable] of chosen) {
      await admin.query(`CREATE DATABASE "${name}"`);
      const target = new URL(url); target.pathname = `/${name}`; env[variable] = target.href;
    }
  } finally { await admin.end(); }
  await run("build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--sourceMap", "--inlineSources"], env);
  if (!process.env.VC17_SUITES) await run("unit", ["scripts/run-tests.mjs", "src", ".spec.ts,.spec.js"], env);
  // Chạy cùng các ví dụ lịch trên ba TZ để phát hiện helper vô tình dùng ngày địa phương của máy
  // Mỗi tiến trình nhận TZ riêng, không thay đổi đồng hồ hoặc timezone của PostgreSQL dùng chung
  if (!process.env.VC17_SUITES) for (const timezone of ["UTC", "Asia/Ho_Chi_Minh", "America/New_York"]) await run(`timezone-${timezone.replaceAll("/", "-")}`, ["--import", "tsx", "--test", "src/common/services/deadline-calculator.spec.ts", "src/modules/evaluations/review-policy.spec.ts"], { ...env, TZ: timezone });
  let failed = false;
  for (const [name, database, variable, files, upgrade] of chosen) {
    const target = new URL(url); target.pathname = `/${database}`;
    const suiteEnv = { ...env, DATABASE_URL: target.href, [variable]: target.href };
    // Các DB độc lập nên lỗi một bộ vẫn cho phép thu bằng chứng các bộ khác, mã thoát cuối luôn báo thất bại
    // Không retry hoặc reset dữ liệu để che lỗi, mỗi bộ chỉ chạy đúng một lần trong lượt tổng hợp
    try {
      if (!upgrade) await run(`migrate-${name}`, ["node_modules/prisma/build/index.js", "migrate", "deploy"], suiteEnv);
      if (name === "browser") await browser(suiteEnv);
      else await run(name, ["--import", "tsx", "--test", "--test-concurrency=1", ...files.map((file) => `test/integration/${file}.test.ts`)], suiteEnv);
    } catch { failed = true; }
  }
  stage = "tổng hợp kết quả";
  if (failed) throw new Error("Có bộ kiểm thử VC17 chưa đạt");
}

/** Luôn ghi kết quả cả khi có lỗi và chỉ hiển thị nhãn bước, không in chuỗi kết nối hoặc lỗi provider thô */
main().catch(() => { process.stderr.write(`VC17 chưa đạt tại bước ${stage}, xem báo cáo kiểm thử cục bộ\n`); process.exitCode = 1; }).finally(async () => {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, "suite-results.json"), JSON.stringify({ results, complete: process.exitCode !== 1 }, null, 2));
});
