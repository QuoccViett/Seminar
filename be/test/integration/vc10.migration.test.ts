import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

/** Kiểm nâng cấp đúng bảy migration cũ lên VC10 trong database mới của container thử riêng
 * Không reset, không xóa database, không kết nối container dùng chung và không sửa migration cũ
 * Fixture giữ user/hash/version, score/note và Evidence để kiểm migration không backfill phá dữ liệu
 */
test("VC10 nâng cấp 7→8 migration giữ nguyên dữ liệu hiện có", () => {
  const container = process.env.VC10_MIGRATION_CONTAINER;
  assert.equal(container, "seminar-vc10-test-20261118", "Chỉ được dùng container PostgreSQL riêng của VC10");
  const database = `vc10_upgrade_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  /** Chạy SQL hằng qua stdin UTF-8, chỉ trả stdout cho assertion, không dùng shell interpolation
   * ON_ERROR_STOP khiến bất kỳ CHECK/SQL sai dừng phép thử, tên DB do test sinh không nhận từ client
   */
  function sql(input: string, target = database) {
    return execFileSync("docker", ["exec", "-i", container!, "psql", "-U", "vc10", "-d", target, "-v", "ON_ERROR_STOP=1", "-At"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  }

  sql(`CREATE DATABASE ${database};`, "postgres");
  const root = new URL("../../prisma/migrations/", import.meta.url);
  const migrations = readdirSync(root).filter((name) => /^\d/.test(name)).sort();
  assert.equal(migrations.length, 8);
  for (const migration of migrations.slice(0, 7)) sql(readFileSync(new URL(`${migration}/migration.sql`, root), "utf8"));
  // Fixture nằm trong cửa sổ tự chấm để trigger thật cho phép tạo minh chứng, không tắt ràng buộc
  sql(`
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
  sql(readFileSync(new URL(`${migrations[7]}/migration.sql`, root), "utf8"));
  assert.equal(sql("SELECT password_hash || ':' || credential_version FROM users;").trim(), "hash-can-giu:7");
  assert.equal(sql("SELECT self_score || ':' || self_note FROM criterion_scores;").trim(), "85.25:Diễn giải cần giữ");
  assert.equal(sql("SELECT external_url FROM evidences;").trim(), "https://example.org/minh-chung");
  assert.equal(sql("SELECT count(*) FROM evidence_uploads;").trim(), "0");
});
