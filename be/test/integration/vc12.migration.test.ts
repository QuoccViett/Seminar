import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";

/** Nâng cấp 9 → 10 trên database riêng, giữ nguyên người dùng, điểm, diễn giải và minh chứng
 * Nếu database trống thì áp SQL nền trước, nếu đã nâng cấp thì từ chối thay vì reset dữ liệu
 * Không dùng mock SQL, migration mới được chạy nguyên văn để kiểm backfill baseline và tính bất biến
 */
test("VC12 migration giữ dữ liệu và tạo baseline an toàn cho vòng đang mở", async () => {
  const url = process.env.VC12_UPGRADE_DATABASE_URL;
  assert.ok(url && new URL(url).pathname === "/vc12_upgrade_test", "Cần database vc12_upgrade_test riêng");
  const client = new pg.Client({ connectionString: url, options: "-c timezone=UTC" });
  await client.connect();
  const directory = new URL("../../prisma/migrations/", import.meta.url);
  try {
    const exists = await client.query("SELECT to_regclass('public.evaluations') AS name");
    if (!exists.rows[0].name) {
      const paths = (await readdir(directory)).filter((name) => /^\d/u.test(name) && name < "20261118160000_vc12_supplement_baseline").sort();
      for (const name of paths) await client.query(await readFile(new URL(`${name}/migration.sql`, directory), "utf8"));
    }
    const columns = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='criterion_scores' AND column_name='supplement_baseline'");
    assert.equal(columns.rowCount, 0, "Database nâng cấp phải đang ở phiên bản trước VC12, không tự reset database đã nâng cấp");
    const admin = randomUUID(); const unit = randomUUID(); const period = randomUUID(); const evaluation = randomUUID(); const criterion = randomUUID(); const score = randomUUID();
    await client.query("INSERT INTO users(id,username,password_hash,full_name,role,must_change_password,credential_version,created_at,updated_at) VALUES($1,$2,'hash-kiem-thu-khong-phai-mat-khau-that','Người kiểm migration','ADMIN',false,4,now(),now())", [admin, `vc12-upgrade-${admin}`]);
    await client.query("INSERT INTO units(id,code,name,created_at,updated_at) VALUES($1,$2,'Đơn vị nâng cấp',now(),now())", [unit, `VC12-${unit}`]);
    await client.query("INSERT INTO evaluation_periods(id,year,name,phase,max_total_score,self_eval_start,self_eval_deadline,published_at,created_by_id,created_at,updated_at) VALUES($1,2099,'Kỳ nâng cấp','SELF_EVAL',10,now()-interval '1 hour',now()+interval '1 hour',now(),$2,now(),now())", [period, admin]);
    await client.query("INSERT INTO criteria(id,period_id,code,name,max_score,sort_order,created_at,updated_at) VALUES($1,$2,'A','Tiêu chí giữ nguyên',10,0,now(),now())", [criterion, period]);
    await client.query("INSERT INTO evaluations(id,period_id,unit_id,status,created_at,updated_at) VALUES($1,$2,$3,'DRAFT',now(),now())", [evaluation, period, unit]);
    await client.query("INSERT INTO criterion_scores(id,evaluation_id,criterion_id,self_score,self_note,admin_score,admin_comment,reviewed_by_id,reviewed_at,created_at,updated_at) VALUES($1,$2,$3,8.25,'Diễn giải cần giữ',6.25,'Lý do cần giữ',$4,now(),now(),now())", [score, evaluation, criterion, admin]);
    await client.query("INSERT INTO evidences(id,criterion_score_id,uploader_id,kind,round,external_url,created_at) VALUES($1,$2,$3,'LINK','INITIAL','https://example.com/minh-chung-cu',now())", [randomUUID(), score, admin]);
    await client.query("UPDATE evaluation_periods SET phase='FIRST_REVIEW' WHERE id=$1", [period]);
    await client.query("UPDATE criterion_scores SET needs_supplement=true,supplement_note='Yêu cầu đang mở' WHERE id=$1", [score]);
    await client.query("UPDATE evaluations SET status='SUPPLEMENT_REQUESTED',first_reviewed_at=now(),supplement_requested_at=now(),supplement_start_at=now()-interval '1 minute',supplement_deadline=now()+interval '1 hour' WHERE id=$1", [evaluation]);

    /** Chụp toàn bộ dữ liệu cần bảo toàn, loại riêng cột mới để so trước/sau chính xác */
    async function snapshot() {
      return (await client.query("SELECT jsonb_build_object('user',(SELECT to_jsonb(u) FROM users u WHERE id=$1),'score',(SELECT to_jsonb(cs)-'supplement_baseline' FROM criterion_scores cs WHERE id=$2),'evidences',(SELECT jsonb_agg(to_jsonb(ev) ORDER BY id) FROM evidences ev WHERE criterion_score_id=$2)) AS data", [admin, score])).rows[0].data;
    }
    const before = await snapshot();
    await client.query(await readFile(new URL("20261118160000_vc12_supplement_baseline/migration.sql", directory), "utf8"));
    assert.deepEqual(await snapshot(), before);
    const baseline = await client.query("SELECT supplement_baseline, fn_vc12_supplement_changed(id) AS changed FROM criterion_scores WHERE id=$1", [score]);
    assert.equal(baseline.rows[0].supplement_baseline.source, "MIGRATION");
    assert.equal(baseline.rows[0].supplement_baseline.content.selfNote, "Diễn giải cần giữ");
    assert.equal(baseline.rows[0].changed, false);
    await assert.rejects(client.query("UPDATE criterion_scores SET supplement_baseline='{}'::jsonb WHERE id=$1", [score]));
  } finally { await client.end(); }
});
