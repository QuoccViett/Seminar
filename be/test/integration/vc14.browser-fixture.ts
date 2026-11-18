import { writeFile, mkdir } from "node:fs/promises";
import { createVc12Harness } from "./vc12-support.js";

/** Mở backend thật và một kỳ riêng cho browser VC14, không bật gửi provider
 * Thông tin đăng nhập chỉ lưu tạm trong thư mục Git bỏ qua để người kiểm thử dùng tại máy local
 */
const h = await createVc12Harness({ url: process.env.VC14_TEST_DATABASE_URL, name: "vc14_test" });
const sample = await h.scenario(2, 100, [50, 35]);
await mkdir(".tmp", { recursive: true });
await writeFile(".tmp/vc14-browser-state.json", JSON.stringify({ base: h.base, username: h.username, password: h.password, periodId: sample.periodId, evaluationId: sample.records[0].evaluationId }));
process.stdout.write("Backend VC14 local đã sẵn sàng cho trình duyệt\n");

/** Đóng Nest khi dừng helper, giữ dữ liệu fixture để đối chiếu sau kiểm */
process.on("SIGINT", () => { void h.app.close().then(() => process.exit(0)); });
