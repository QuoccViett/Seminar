import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

/** Reset chỉ được dùng với DB local có tên demo riêng và ba xác nhận đích khớp nhau */
try {
  const target = new URL(process.env.DATABASE_URL ?? "");
  const database = target.pathname.slice(1);
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_RESET !== "true" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(target.hostname) ||
    !/^seminar_demo(?:_[a-z0-9]+)?$/.test(database) ||
    process.env.RESET_DEMO_DATABASE !== database || !process.argv.includes(`--database=${database}`)) {
    throw new Error("Đích reset không hợp lệ");
  }
  console.warn(`Sắp xóa toàn bộ dữ liệu trong DB demo local ${database}; không gửi provider hoặc seed demo tự động`);
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve("prisma/build/index.js")), "migrate", "reset", "--force"], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} catch {
  console.error("Từ chối reset: cần DB local seminar_demo[_hậu_tố], ALLOW_DEMO_RESET=true, RESET_DEMO_DATABASE và --database trùng tên; không dùng ở production");
  process.exitCode = 1;
}
