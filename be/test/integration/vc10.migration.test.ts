import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";

/** Kiểm nâng cấp đúng bảy migration cũ lên VC10 trong database local mới dành riêng cho thử
 * Không reset, không xóa database, không kết nối DB dùng chung và không sửa migration cũ
 * Fixture giữ user/hash/version, score/note và Evidence để kiểm migration không backfill phá dữ liệu
 */
test("VC10 nâng cấp 7→8 migration giữ nguyên dữ liệu hiện có", async () => {
  const url = new URL(process.env.VC10_UPGRADE_DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/vc10_upgrade_test", "Cần database vc10_upgrade_test local riêng");
  const client = new pg.Client({ connectionString: url.href, options: "-c timezone=UTC" });
  await client.connect();

  /** Chạy SQL hằng qua driver PostgreSQL, chỉ trả giá trị cột cho assertion và không dùng shell
   * Lỗi CHECK hoặc SQL dừng phép thử, URL phải trỏ đúng database local được runner tạo mới
   */
  async function sql(input: string): Promise<string> {
    const result = await client.query(input);
    return Array.isArray(result) ? "" : result.rows.map((row) => Object.values(row).join("|")).join("\n");
  }

  try {
  assert.equal((await client.query("SELECT to_regclass('public.units') AS name")).rows[0].name, null, "Database nâng cấp phải trống, không tự reset");
  const root = new URL("../../prisma/migrations/", import.meta.url);
  const migrations = (await readdir(root)).filter((name) => /^\d/.test(name)).sort();
  assert.equal(migrations[7], "20261118120000_vc10_evidence_uploads");
  for (const migration of migrations.slice(0, 7)) await sql(await readFile(new URL(`${migration}/migration.sql`, root), "utf8"));
  // Fixture nằm trong cửa sổ tự chấm để trigger thật cho phép tạo minh chứng, không tắt ràng buộc
  await sql(`
    INSERT INTO units(id,code,name,created_at,updated_at) VALUES ('11111111-1111-4111-8111-111111111111','VC10-UPGRADE','Đơn vị nâng cấp',now(),now());
    INSERT INTO users(id,username,password_hash,must_change_password,full_name,role,unit_id,credential_version,created_at,updated_at)
    VALUES ('22222222-2222-4222-8222-222222222222','vc10-upgrade','hash-can-giu',false,'Tài khoản nâng cấp','UNIT','11111111-1111-4111-8111-111111111111',7,now(),now());
    INSERT INTO evaluation_periods(id,year,name,phase,published_at,self_eval_start,self_eval_deadline,created_by_id,created_at,updated_at)
    VALUES ('33333333-3333-4333-8333-333333333333',2090,'Kỳ nâng cấp','SELF_EVAL',now(),now()-interval '1 day',now()+interval '1 day','22222222-2222-4222-8222-222222222222',now(),now());
    INSERT INTO criteria(id,period_id,code,name,max_score,sort_order,created_at,updated_at)
    VALUES ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','MC','Minh chứng',100,1,now(),now());
    INSERT INTO evaluations(id,period_id,unit_id,created_at,updated_at)
    VALUES ('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',now(),now());
    INSERT INTO criterion_scores(id,evaluation_id,criterion_id,self_score,self_note,created_at,updated_at)
    VALUES ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444',85.25,'Diễn giải cần giữ',now(),now());
    INSERT INTO evidences(id,criterion_score_id,uploader_id,kind,round,external_url,created_at)
    VALUES ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','LINK','INITIAL','https://example.org/minh-chung',now());
  `);
  await sql(await readFile(new URL(`${migrations[7]}/migration.sql`, root), "utf8"));
  assert.equal((await sql("SELECT password_hash || ':' || credential_version FROM users;")).trim(), "hash-can-giu:7");
  assert.equal((await sql("SELECT self_score || ':' || self_note FROM criterion_scores;")).trim(), "85.25:Diễn giải cần giữ");
  assert.equal((await sql("SELECT external_url FROM evidences;")).trim(), "https://example.org/minh-chung");
  assert.equal((await sql("SELECT count(*) FROM evidence_uploads;")).trim(), "0");
  } finally { await client.end(); }
});
