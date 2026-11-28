import "dotenv/config";
import process from "node:process";
import { URL } from "node:url";
import console from "node:console";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import bcrypt from "bcrypt";
import pg from "pg";

// Chỉ đọc credential đã lộ trong bộ nhớ, báo cáo tuyệt đối không chứa mật khẩu hoặc hash
const revision = "0dc91991cedd216ba86f5a318ad4bba6b5fe2f33";
const apply = process.argv.includes("--apply");
const source = JSON.parse(execFileSync("git", ["show", `${revision}:be/credentials.json`], { encoding: "utf8", maxBuffer: 1024 * 1024 }));
const url = new URL(process.env.DATABASE_URL ?? "");
if (apply && (!process.argv.includes(`--database=${url.pathname.slice(1)}`) || !["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Chỉ đổi trên DB local có tên được chỉ định rõ; môi trường khác cần quy trình vận hành riêng");
const client = new pg.Client({ connectionString: url.href });
const report = { revision, environment: { host: url.hostname, database: url.pathname.slice(1) }, applied: apply, checked: source.length, accounts: [] };
const replacements = [];
try {
  await client.connect();
  await client.query("BEGIN");
  for (const entry of source) {
    const { rows } = await client.query(`SELECT id,username,password_hash,is_active FROM users WHERE lower(username)=lower($1) ${apply ? "FOR UPDATE" : ""}`, [entry.username]);
    const user = rows[0];
    const matches = !!user && await bcrypt.compare(entry.password, user.password_hash);
    report.accounts.push({ username: entry.username, state: !user ? "ABSENT" : !matches ? "ALREADY_CHANGED" : !user.is_active ? "DISABLED_MATCH" : "ACTIVE_MATCH" });
    if (!matches || !apply) continue;
    const password = randomBytes(24).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query("UPDATE users SET password_hash=$2,must_change_password=true,credential_version=credential_version+1,password_changed_at=now(),credentials_sent_at=NULL,updated_at=now() WHERE id=$1", [user.id, passwordHash]);
    await client.query("UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [user.id]);
    await client.query("UPDATE web_push_subscriptions SET revoked_at=now(),updated_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [user.id]);
    await client.query("UPDATE credential_dispatches SET canceled_at=now(),ciphertext=NULL,nonce=NULL,auth_tag=NULL WHERE user_id=$1 AND canceled_at IS NULL", [user.id]);
    await client.query("UPDATE onboarding_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [user.id]);
    await client.query("INSERT INTO audit_logs(id,actor_id,action,entity,entity_id,after,created_at) VALUES($1,NULL,'EXPOSED_PASSWORD_ROTATED','User',$2,$3::jsonb,now())", [randomUUID(), user.id, JSON.stringify({ sourceRevision: revision, sessionsRevoked: true })]);
    replacements.push({ username: user.username, password });
    report.accounts.at(-1).state = "ROTATED_AND_REVOKED";
    const after = await client.query("SELECT password_hash FROM users WHERE id=$1", [user.id]);
    if (await bcrypt.compare(entry.password, after.rows[0].password_hash)) throw new Error("Mật khẩu cũ chưa bị vô hiệu");
  }
  // Ghi tệp khôi phục private trước commit; lỗi filesystem phải rollback DB
  if (replacements.length) await writeFile(`.seed-credentials-rotation-${Date.now()}.json`, JSON.stringify(replacements, null, 2), { mode: 0o600, flag: "wx" });
  await client.query(apply ? "COMMIT" : "ROLLBACK");
  await mkdir(".tmp", { recursive: true });
  await writeFile(`.tmp/security-credentials-${apply ? "applied" : "audit"}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checked: report.checked, applied: apply, states: report.accounts.reduce((sum, item) => ({ ...sum, [item.state]: (sum[item.state] ?? 0) + 1 }), {}) }));
} catch {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Không hoàn tất kiểm/đổi credential; kiểm cấu hình và schema, không in lỗi có bí mật");
  process.exitCode = 1;
} finally { await client.end(); }
