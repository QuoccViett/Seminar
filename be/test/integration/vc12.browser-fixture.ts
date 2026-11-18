import { mkdir, writeFile } from "node:fs/promises";
import { createVc12Harness } from "./vc12-support.js";

/** Khởi tạo backend và hai hồ sơ thật phục vụ kiểm browser trên database test riêng
 * Thông tin tài khoản giả chỉ lưu trong thư mục tạm được Git bỏ qua, không dùng secret thật
 * Không tự mở lịch bổ sung hoặc chốt, các bước nghiệp vụ được thao tác qua giao diện
 */
const harness = await createVc12Harness();
const scenario = await harness.scenario(2);
await mkdir(".tmp", { recursive: true });
await writeFile(".tmp/vc12-browser-state.json", JSON.stringify({ base: harness.base, admin: { username: harness.username, password: harness.password }, scenario, password: harness.password }, null, 2));
process.stdout.write("Backend kiểm thử VC12 đã sẵn sàng, thông tin fixture nằm trong thư mục tạm\n");

/** Đóng Nest khi dừng helper, không xóa fixture hoặc tác động database dùng chung */
process.on("SIGINT", () => { void harness.app.close().then(() => process.exit(0)); });
