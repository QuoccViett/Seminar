import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import pg from "pg";

/** Nâng cấp nền chín migration với yêu cầu theo hạn 48 giờ cũ lên toàn bộ SQL hiện tại
 * Chỉ chạy trên DB mới vc17_upgrade_test, giữ nguyên hạn đã gửi thay vì tự chuyển sang lịch tạm
 * Snapshot có user/hash, score/note, evidence, audit/history và kiểm baseline mới không mất dữ liệu
 */
test("VC17 upgrade giữ snapshot lịch cũ, Auth, Decimal và dữ liệu append-only", async () => {
  const url = new URL(process.env.VC17_UPGRADE_DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/vc17_upgrade_test", "Cần database nâng cấp VC17 riêng");
  const db = new pg.Client({ connectionString: url.href, options: "-c timezone=UTC" }); await db.connect();
  try {
    assert.equal((await db.query("SELECT to_regclass('public.users') AS name")).rows[0].name, null, "Database nâng cấp phải trống, không được reset DB đã tồn tại");
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const migrations = (await readdir(directory)).filter((name) => /^\d/u.test(name)).sort();
    for (const name of migrations.slice(0, 9)) await db.query(await readFile(new URL(`${name}/migration.sql`, directory), "utf8"));
    const admin = randomUUID(); const unit = randomUUID(); const period = randomUUID(); const evaluation = randomUUID(); const criterion = randomUUID(); const score = randomUUID();
    const passwordHash = await bcrypt.hash("MatkhauNangCapVC17-9", 4);
    await db.query("INSERT INTO users(id,username,password_hash,full_name,role,must_change_password,credential_version,created_at,updated_at) VALUES($1,$2,$3,'Người kiểm nâng cấp','ADMIN',false,7,now(),now())", [admin, `vc17-${admin}`, passwordHash]);
    await db.query("INSERT INTO units(id,code,name,created_at,updated_at) VALUES($1,$2,'Đơn vị nâng cấp',now(),now())", [unit, `VC17-${unit}`]);
    await db.query("INSERT INTO evaluation_periods(id,year,name,phase,max_total_score,self_eval_start,self_eval_deadline,published_at,created_by_id,created_at,updated_at) VALUES($1,2099,'Kỳ lịch cũ','SELF_EVAL',100,now()-interval '1 day',now()+interval '1 day',now(),$2,now(),now())", [period, admin]);
    await db.query("INSERT INTO criteria(id,period_id,code,name,max_score,sort_order,created_at,updated_at) VALUES($1,$2,'A','Tiêu chí nâng cấp',100,0,now(),now())", [criterion, period]);
    await db.query("INSERT INTO evaluations(id,period_id,unit_id,status,created_at,updated_at) VALUES($1,$2,$3,'DRAFT',now(),now())", [evaluation, period, unit]);
    await db.query("INSERT INTO criterion_scores(id,evaluation_id,criterion_id,self_score,self_note,admin_score,admin_comment,created_at,updated_at) VALUES($1,$2,$3,85.01,'Diễn giải cần giữ',80.25,'Lý do điều chỉnh cần giữ',now(),now())", [score, evaluation, criterion]);
    await db.query("INSERT INTO evidences(id,criterion_score_id,uploader_id,kind,round,external_url,created_at) VALUES($1,$2,$3,'LINK','INITIAL','https://example.invalid/minh-chung-cu',now())", [randomUUID(), score, admin]);
    await db.query("UPDATE evaluation_periods SET phase='FIRST_REVIEW' WHERE id=$1", [period]);
    await db.query("UPDATE criterion_scores SET needs_supplement=true,supplement_note='Yêu cầu theo lịch cũ' WHERE id=$1", [score]);
    await db.query("UPDATE evaluations SET status='SUPPLEMENT_REQUESTED',supplement_requested_at=now()-interval '1 hour',supplement_start_at=now()-interval '1 hour',supplement_deadline=now()+interval '47 hours' WHERE id=$1", [evaluation]);
    await db.query("INSERT INTO status_histories(id,evaluation_id,to_status,created_at) VALUES($1,$2,'SUPPLEMENT_REQUESTED',now())", [randomUUID(), evaluation]);
    await db.query("INSERT INTO audit_logs(id,actor_id,action,entity,entity_id,created_at) VALUES($1,$2,'SUPPLEMENT_REQUEST','Evaluation',$3,now())", [randomUUID(), admin, evaluation]);

    /** Băm snapshot đã sắp xếp để lỗi assertion không in hash mật khẩu hoặc dữ liệu riêng ra log */
    async function snapshot() {
      const rows: unknown[] = [];
      for (const table of ["users", "evaluations", "evidences", "status_histories", "audit_logs"]) rows.push((await db.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS data FROM ${table} t`)).rows[0].data);
      rows.push((await db.query("SELECT jsonb_agg(to_jsonb(t)-'supplement_baseline' ORDER BY id) AS data FROM criterion_scores t")).rows[0].data);
      return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    }
    const before = await snapshot();
    for (const name of migrations.slice(9)) await db.query(await readFile(new URL(`${name}/migration.sql`, directory), "utf8"));
    assert.equal(await snapshot(), before);
    const saved = (await db.query("SELECT password_hash,credential_version FROM users WHERE id=$1", [admin])).rows[0];
    assert.equal(await bcrypt.compare("MatkhauNangCapVC17-9", saved.password_hash), true); assert.equal(saved.credential_version, 7);
    const result = (await db.query("SELECT self_score::text, supplement_baseline->>'source' AS source FROM criterion_scores WHERE id=$1", [score])).rows[0];
    assert.equal(result.self_score, "85.01"); assert.equal(result.source, "MIGRATION");
    const instant = "2026-12-31T17:00:00.123Z";
    const roundtrip = (await db.query("SELECT ($1::timestamptz AT TIME ZONE 'UTC') AS instant, 9007199254740993::bigint AS large, 85.01::numeric AS decimal", [instant])).rows[0];
    assert.equal(roundtrip.instant.toISOString(), instant); assert.equal(roundtrip.large, "9007199254740993"); assert.equal(roundtrip.decimal, "85.01");
    for (const table of ["audit_logs", "status_histories"]) await assert.rejects(db.query(`DELETE FROM ${table}`), /chỉ được phép thêm mới/u);
    await assert.rejects(db.query("UPDATE criterion_scores SET supplement_baseline='{}'::jsonb WHERE id=$1", [score]), /Không được thay đổi snapshot/u);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM pg_views WHERE schemaname='public' AND viewname IN ('v_evaluation_totals','v_leaderboard','v_criteria_deductions')")).rows[0].count, 3);
    assert.equal(await snapshot(), before);
  } finally { await db.end(); }
});
