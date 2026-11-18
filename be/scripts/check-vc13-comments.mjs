import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Đọc kết quả Git bằng argv tách riêng, không ghép đường dẫn vào lệnh shell
 * Đầu vào là tham số Git tin cậy trong script, đầu ra là UTF-8 để giữ dấu tiếng Việt
 */
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }

/** Xác định dòng thêm/sửa theo hunk, bỏ dòng xóa để không bắt sửa comment cũ ngoài phạm vi
 * Tệp mới được kiểm toàn bộ, tệp tracked chỉ kiểm comment chứa ít nhất một dòng vừa thay
 */
function changedLines(path, isNew, content) {
  if (isNew) return new Set(content.split("\n").map((_, index) => index + 1));
  const lines = new Set(); let cursor = 0;
  for (const line of git(["diff", "HEAD", "--unified=0", "--", path]).split("\n")) {
    const hunk = /^@@ .* \+(\d+)/.exec(line);
    if (hunk) cursor = Number(hunk[1]);
    else if (line.startsWith("+") && !line.startsWith("+++")) lines.add(cursor++);
    else if (!line.startsWith("-") && !line.startsWith("\\")) cursor++;
  }
  return lines;
}

/** Tách comment bằng AST TypeScript để URL, regex và template không bị tính là comment
 * SQL/YAML dùng comment từng dòng, chỉ chạy cho các loại tệp nguồn trong phạm vi VC13
 */
function comments(content, path) {
  if (/\.(sql|yml|yaml)$/.test(path)) return [...content.matchAll(/^\s*(?:--|#).*$/gm)].map((match) => ({ start: match.index, value: match[0] }));
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true); const result = new Map();
  /** Duyệt cả token con để lấy comment giữa JSX và các decorator, chống đếm trùng bằng vị trí
   * Parser đã nhận diện regex/template nên không nhầm dấu gạch chéo trong dữ liệu thành comment
   */
  function visit(node) {
    for (const range of [...ts.getLeadingCommentRanges(content, node.pos) ?? [], ...ts.getTrailingCommentRanges(content, node.end) ?? []]) result.set(range.pos, { start: range.pos, value: content.slice(range.pos, range.end) });
    for (const child of node.getChildren(source)) visit(child);
  }
  visit(source);
  return [...result.values()].sort((a, b) => a.start - b.start);
}

/** Rà các comment mới/sửa có dấu tiếng Việt và không dòng nào kết thúc bằng dấu chấm
 * Chỉ báo vị trí và lý do, không in source hoặc bí mật từ fixture vào log kiểm tra
 * Không sửa tự động, lỗi trả exit code 1 để người viết rà ý nghĩa trước khi bàn giao
 */
function main() {
  const newFiles = new Set(git(["ls-files", "--others", "--exclude-standard"]).trim().split("\n").filter(Boolean));
  const paths = new Set([...git(["diff", "HEAD", "--name-only"]).trim().split("\n").filter(Boolean), ...newFiles]);
  const failures = []; let count = 0; let files = 0;
  for (const path of paths) {
    if (!/\.(ts|tsx|js|jsx|mjs|sql|yml|yaml)$/.test(path) || path.includes("/generated/")) continue;
    const content = readFileSync(resolve(root, path), "utf8"); const changed = changedLines(path, newFiles.has(path), content); let inspected = false;
    for (const comment of comments(content, path)) {
      const first = content.slice(0, comment.start).split("\n").length; const lines = comment.value.split("\n");
      if (!lines.some((_, offset) => changed.has(first + offset))) continue;
      inspected = true;
      if (!/[À-ỹ]/u.test(comment.value)) failures.push(`${path}:${first} — Comment cần có nội dung tiếng Việt có dấu`);
      lines.forEach((line, offset) => {
        const text = line.trim().replace(/^(?:\/\*+|\/\/|--|#|\*)\s?/, "").replace(/\*\/$/, "").trim();
        if (!text) return; count++;
        if (text.endsWith(".")) failures.push(`${path}:${first + offset} — Dòng comment đang kết thúc bằng dấu chấm`);
      });
    }
    if (inspected) files++;
  }
  if (failures.length) { process.stderr.write(`${failures.join("\n")}\n`); process.exitCode = 1; }
  else process.stdout.write(`Đã rà ${count} dòng comment tại ${files} tệp, tiếng Việt có dấu và không có dấu chấm cuối dòng\n`);
}

try { main(); }
catch { process.stderr.write("Không thể kiểm tra comment VC13, cần chạy trong repository có Git và dependency TypeScript\n"); process.exitCode = 1; }
