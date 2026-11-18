import { mkdir, writeFile } from "node:fs/promises";
import { createVc12Harness } from "./vc12-support.js";

/** Dựng backend thật và hồ sơ riêng để thao tác trình duyệt VC13, không bật provider ngoài
 * Tài khoản thử và token chỉ lưu ở thư mục tạm Git bỏ qua, không dùng để đăng nhập môi trường chung
 * Giữ server hoạt động cho tới khi dừng script, không reset hoặc xóa database sau kiểm
 */
process.env.REPORT_EXPORT_DIR = ".tmp/vc13-report-exports";
const h = await createVc12Harness({ url: process.env.VC13_TEST_DATABASE_URL, name: "vc13_test" });
const scenario = await h.scenario(1, 100, [8, 35]);
await h.request("PUT", `admin/evaluations/${scenario.records[0].evaluationId}/scores/${scenario.leaf1}/review`, h.adminToken, { adminScore: 8 });
await h.request("PUT", `admin/evaluations/${scenario.records[0].evaluationId}/scores/${scenario.leaf1}/review`, h.adminToken, { adminScore: 6, adminComment: "Trừ 2 điểm vì cần giải trình thêm" });
await mkdir(".tmp", { recursive: true });
await writeFile(".tmp/vc13-browser-state.json", JSON.stringify({ base: h.base, admin: { username: h.username, password: h.password }, scenario, password: h.password }, null, 2));
process.stdout.write("Backend kiểm thử VC13 đã sẵn sàng, fixture nằm trong thư mục tạm\n");

/** Đóng Nest khi người vận hành dừng helper, giữ fixture để đối chiếu audit sau thử */
process.on("SIGINT", () => { void h.app.close().then(() => process.exit(0)); });
