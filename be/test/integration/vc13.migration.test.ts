import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";

/** Áp 10 migration cũ trên database trống riêng rồi nâng 10 → 11 với dữ liệu có sẵn
 * Không reset hoặc sửa trigger cũ, so snapshot người dùng/hồ sơ/phản hồi/history/audit trước và sau
 * Từ chối DB đã có schema để phép kiểm nâng cấp không vô tình chạy lại hoặc xóa dữ liệu
 */
test("VC13 nâng cấp giữ nguyên dữ liệu và khóa sửa/xóa phản hồi", async () => {
  const url = process.env.VC13_UPGRADE_DATABASE_URL;
  assert.ok(url && new URL(url).pathname === "/vc13_upgrade_test" && ["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Cần database local vc13_upgrade_test mới riêng");
  const db = new pg.Client({ connectionString: url, options: "-c timezone=UTC" }); await db.connect();
  try {
    assert.equal((await db.query("SELECT to_regclass('public.users') AS name")).rows[0].name, null, "Database nâng cấp phải mới, không tự reset dữ liệu cũ");
    const directory = new URL("../../prisma/migrations/", import.meta.url); const name = "20261118170000_vc13_feedback_append_only";
    for (const migration of (await readdir(directory)).filter((value) => /^\d/.test(value) && value < name).sort()) await db.query(await readFile(new URL(`${migration}/migration.sql`, directory), "utf8"));
    const user = randomUUID(); const unit = randomUUID(); const period = randomUUID(); const evaluation = randomUUID(); const feedback = randomUUID();
    await db.query("INSERT INTO users(id,username,password_hash,full_name,role,credential_version,created_at,updated_at) VALUES($1,$2,'hash-kiem-thu','Người kiểm nâng cấp','ADMIN',4,now(),now())", [user, `vc13-${user}`]);
    await db.query("INSERT INTO units(id,code,name,created_at,updated_at) VALUES($1,$2,'Đơn vị kiểm nâng cấp',now(),now())", [unit, `VC13-${unit}`]);
    await db.query("INSERT INTO evaluation_periods(id,year,name,phase,max_total_score,created_by_id,created_at,updated_at) VALUES($1,2098,'Kỳ kiểm nâng cấp','SETUP',100,$2,now(),now())", [period, user]);
    await db.query("INSERT INTO evaluations(id,period_id,unit_id,status,created_at,updated_at) VALUES($1,$2,$3,'DRAFT',now(),now())", [evaluation, period, unit]);
    await db.query("INSERT INTO evaluation_feedbacks(id,evaluation_id,author_id,type,content,created_at) VALUES($1,$2,$3,'GENERAL','Nội dung phản hồi cũ có dấu',now())", [feedback, evaluation, user]);
    await db.query("INSERT INTO status_histories(id,evaluation_id,actor_id,to_status,created_at) VALUES($1,$2,NULL,'DRAFT',now())", [randomUUID(), evaluation]);
    await db.query("INSERT INTO audit_logs(id,actor_id,action,entity,entity_id,created_at) VALUES($1,$2,'CREATE','Evaluation',$3,now())", [randomUUID(), user, evaluation]);

    /** Chụp nguyên bản các bảng liên quan, sắp theo UUID để phép so không phụ thuộc kế hoạch truy vấn */
    async function snapshot() {
      const result: Record<string, unknown> = {};
      for (const table of ["users", "evaluations", "evaluation_feedbacks", "status_histories", "audit_logs"]) result[table] = (await db.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS data FROM ${table} t`)).rows[0].data;
      return result;
    }
    const before = await snapshot(); await db.query(await readFile(new URL(`${name}/migration.sql`, directory), "utf8")); assert.deepEqual(await snapshot(), before);
    for (const sql of ["UPDATE evaluation_feedbacks SET content='Đổi nội dung' WHERE id=$1", "DELETE FROM evaluation_feedbacks WHERE id=$1"]) await assert.rejects(db.query(sql, [feedback]), /chỉ được phép thêm mới/);
    assert.deepEqual(await snapshot(), before);
  } finally { await db.end(); }
});
