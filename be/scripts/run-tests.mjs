import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { error } from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Tìm đệ quy các tệp khớp thư mục gốc và hậu tố đã cấu hình */
function findTestFiles(directory, suffix) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(entryPath, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [entryPath] : [];
  });
}

/** Tìm và chạy các tệp kiểm thử bằng Node cùng tsx theo thư mục và hậu tố đầu vào
 * Nếu thư mục không đọc được hoặc không có tệp thì trả mã lỗi và câu tiếng Việt
 * Không in ngoại lệ filesystem vì đường dẫn hoặc nội dung hệ thống có thể nhạy cảm
 */
function runTests() {
  const [root, suffix, ...options] = process.argv.slice(2);
  if (!root || !suffix) {
    error("Cần cung cấp thư mục kiểm thử và hậu tố tên tệp");
    process.exitCode = 2;
    return;
  }

  let files;
  try {
    files = findTestFiles(resolve(root), suffix);
  } catch {
    error("Không thể đọc thư mục kiểm thử đã chỉ định");
    process.exitCode = 1;
    return;
  }
  if (files.length === 0) {
    error(`Không tìm thấy tệp kiểm thử ${suffix} trong ${root}`);
    process.exitCode = 1;
    return;
  }

  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  const runnerOptions = ["--test", "--test-concurrency=1"];
  if (options.includes("--coverage")) {
    runnerOptions.push("--experimental-test-coverage");
  }
  const result = spawnSync(process.execPath, [tsxCli, ...runnerOptions, ...files], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
}

runTests();
