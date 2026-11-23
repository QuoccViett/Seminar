import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

const root = fileURLToPath(new URL("../", import.meta.url));
const [action, project, envFile, backupDirectory] = process.argv.slice(2);
if (!["backup", "restore"].includes(action) || !/^[a-z0-9-]+$/.test(project ?? "") || !envFile || !backupDirectory) throw new Error("Dùng: node deploy/backup-restore.mjs backup|restore project env-file thư-mục-backup");
if (action === "restore" && !/^seminar-restore-[a-z0-9-]+$/.test(project)) throw new Error("Restore chỉ được tạo project mới seminar-restore-*, không ghi đè môi trường nguồn");
const directory = resolve(backupDirectory);
const docker = (...args) => execFileSync("docker", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 }).trim();
const compose = (...args) => docker("compose", "--env-file", resolve(envFile), "-p", project, "-f", "deploy/compose.yml", ...args);
const sql = (query) => compose("exec", "-T", "postgres", "psql", "-U", "seminar_owner", "-d", "seminar", "-At", "-v", "ON_ERROR_STOP=1", "-c", query);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Hash mọi tệp private trong bản chụp, không ghi bytes hoặc nội dung credential vào manifest */
function filesSnapshot(base) {
  const output = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) output[relative(base, path).replaceAll("\\", "/")] = sha256(path);
    }
  };
  walk(resolve(base, "storage")); walk(resolve(base, "local-files"));
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)));
}

/** So checksum dữ liệu tất cả bảng, chỉ in count/hash, không đọc secret ra log */
function snapshot() {
  const tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").split("\n").map((name) => name.trim()).filter(Boolean);
  if (tables.some((name) => !/^[a-z0-9_]+$/i.test(name))) throw new Error("Tên bảng không hợp lệ");
  if (!tables.length) return "";
  return sql(tables.map((name) => `SELECT '${name}' AS name,count(*) AS count,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS checksum FROM "${name}" t`).join(" UNION ALL ") + " ORDER BY name");
}

try {
  if (action === "backup") {
    if (existsSync(resolve(directory, "manifest.json"))) throw new Error("Thư mục backup đã có dữ liệu");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    compose("stop", "backend");
    try {
      const postgres = compose("ps", "-q", "postgres"); const backend = compose("ps", "-aq", "backend");
      compose("exec", "-T", "postgres", "pg_dump", "-U", "seminar_owner", "-d", "seminar", "-Fc", "-f", "/tmp/seminar-backup.dump");
      docker("cp", `${postgres}:/tmp/seminar-backup.dump`, resolve(directory, "database.dump"));
      docker("cp", `${backend}:/app/storage`, resolve(directory, "storage"));
      docker("cp", `${backend}:/app/.private-storage`, resolve(directory, "local-files"));
      const manifest = { createdAt: new Date().toISOString(), project, databaseSha256: sha256(resolve(directory, "database.dump")), tables: snapshot(), files: filesSnapshot(directory), scope: "PostgreSQL, local evidence and report volumes; bucket Supabase must be backed up separately" };
      writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    } finally { compose("start", "backend"); }
  } else {
    const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
    if (sha256(resolve(directory, "database.dump")) !== manifest.databaseSha256) throw new Error("Checksum backup không khớp");
    compose("up", "-d", "--wait", "postgres");
    if (sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'") !== "0") throw new Error("DB restore phải trống, chọn project mới; không reset DB đã tồn tại");
    const postgres = compose("ps", "-q", "postgres");
    docker("cp", resolve(directory, "database.dump"), `${postgres}:/tmp/seminar-restore.dump`);
    compose("exec", "-T", "postgres", "pg_restore", "-U", "seminar_owner", "-d", "seminar", "--no-owner", "--no-acl", "--exit-on-error", "/tmp/seminar-restore.dump");
    if (snapshot() !== manifest.tables) throw new Error("Dữ liệu restore khác checksum bảng nguồn");
    compose("up", "-d", "--wait", "backend", "frontend");
    const backend = compose("ps", "-q", "backend");
    compose("stop", "backend");
    docker("cp", resolve(directory, "storage") + "/.", `${backend}:/app/storage`);
    docker("cp", resolve(directory, "local-files") + "/.", `${backend}:/app/.private-storage`);
    const verification = resolve(directory, `verify-${project}`);
    mkdirSync(verification, { recursive: true });
    docker("cp", `${backend}:/app/storage`, resolve(verification, "storage"));
    docker("cp", `${backend}:/app/.private-storage`, resolve(verification, "local-files"));
    if (JSON.stringify(filesSnapshot(verification)) !== JSON.stringify(manifest.files)) throw new Error("Checksum tệp restore không khớp");
    compose("start", "backend");
    compose("exec", "-T", "-u", "root", "backend", "chown", "-R", "node:node", "/app/storage", "/app/.private-storage");
    compose("up", "-d", "--wait", "proxy");
    writeFileSync(resolve(directory, `restore-${project}.json`), JSON.stringify({ project, verifiedAt: new Date().toISOString(), tablesMatch: true, fileHashesMatch: true, localVolumesRestored: true }, null, 2));
  }
  console.log(action === "backup" ? "Đã backup DB và volume private, lưu manifest checksum" : "Đã restore trên project mới và đối chiếu tất cả bảng");
} catch { console.error("Backup/restore chưa hoàn tất; không reset DB nguồn, kiểm trạng thái Docker và cấu hình"); process.exitCode = 1; }
