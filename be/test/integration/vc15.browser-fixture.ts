import { mkdir, writeFile } from "node:fs/promises";
import { createVc12Harness } from "./vc12-support.js";

/** Khởi động Nest thật trên DB VC15 riêng với hai kỳ để browser kiểm chọn scope và tạo ba định dạng
 * Chỉ fixture đầu ra VC12, không mock API báo cáo, không reset DB và mọi provider ngoài đều tắt
 * Credential giả được lưu trong thư mục Git bỏ qua, không in token hoặc password ra console
 */
const h = await createVc12Harness({ url: process.env.VC15_TEST_DATABASE_URL, name: "vc15_test" });
const sample = await h.scenario(2, 100, [50.25, 34.75]);
const other = await h.scenario(1, 100, [40, 20]);
await h.prisma.evaluationPeriod.update({ where: { id: sample.periodId }, data: { name: "Kỳ kiểm chứng báo cáo VC15" } });
await h.prisma.evaluationPeriod.update({ where: { id: other.periodId }, data: { name: "Kỳ khác kiểm phạm vi VC15" } });
await h.prisma.unit.update({ where: { id: sample.records[0].unitId }, data: { name: "Đơn vị báo cáo tiếng Việt số một" } });
await h.prisma.unit.update({ where: { id: sample.records[1].unitId }, data: { name: "Đơn vị báo cáo tiếng Việt số hai" } });
await mkdir(".tmp", { recursive: true });
await writeFile(".tmp/vc15-browser-state.json", JSON.stringify({ base: h.base, username: h.username, password: h.password, periodId: sample.periodId, otherPeriodId: other.periodId, evaluationId: sample.records[0].evaluationId, unitId: sample.records[0].unitId }));
process.stdout.write("Backend kiểm chứng VC15 đã sẵn sàng trên loopback\n");

/** Đóng toàn bộ timer và kết nối khi dừng fixture, giữ dữ liệu để đối chiếu số báo cáo và audit */
process.on("SIGINT", () => { void h.app.close().then(() => process.exit(0)); });
