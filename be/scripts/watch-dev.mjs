import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { error as logError } from "node:console";

/** Biên dịch bằng TypeScript trước khi chạy để Nest nhận metadata DTO và dependency
 * Sau lần build đầu thành công, một tiến trình theo dõi source và một tiến trình theo dõi bản biên dịch
 * Không khởi động server nếu build đầu lỗi, dừng cả hai tiến trình khi nhận tín hiệu kết thúc
 */
function startDevelopmentServer() {
  const compiler = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
  const args = [compiler, "-p", "tsconfig.build.json"];
  const initial = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (initial.status !== 0) {
    logError("Không thể khởi động chế độ phát triển vì biên dịch thất bại");
    process.exitCode = initial.status ?? 1;
    return;
  }
  const watcher = spawn(process.execPath, [...args, "--watch", "--preserveWatchOutput"], { stdio: "inherit" });
  const server = spawn(process.execPath, ["--watch", "dist/main.js"], { stdio: "inherit" });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    watcher.kill();
    server.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  watcher.on("exit", (code) => {
    if (!stopping) {
      logError("Tiến trình theo dõi mã nguồn đã dừng");
      process.exitCode = code || 1;
      stop();
    }
  });
  server.on("exit", (code) => {
    if (!stopping) {
      logError("Tiến trình máy chủ phát triển đã dừng");
      process.exitCode = code || 1;
      stop();
    }
  });
}

startDevelopmentServer();
