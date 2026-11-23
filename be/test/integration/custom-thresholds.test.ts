import assert from "node:assert/strict";
import { test } from "node:test";
import { createVc12Harness } from "./vc12-support.js";
import { readReportExcel, readReportPdf, readReportWord } from "./vc15-files.js";

/** So cùng bộ ngưỡng 45/70/90 tại biên trên API, SQL, chốt, dashboard và bytes báo cáo */
test("ngưỡng tùy chỉnh thống nhất mọi consumer và giữ khóa sau công bố", { timeout: 300_000 }, async () => {
  const h = await createVc12Harness({ url: process.env.VC12_TEST_DATABASE_URL, name: "vc12_test" });
  const scores = [0, 44.99, 45, 69.99, 70, 90, 90.01];
  const expected = ["FAIL", "FAIL", "PASS", "PASS", "GOOD", "GOOD", "EXCELLENT"];
  const labels = ["Chưa đạt", "Chưa đạt", "Đạt", "Đạt", "Tốt", "Tốt", "Xuất sắc"];
  const sample = await h.scenario(scores.length, 100, [0, 0], false, [90, 70, 45, 0]);

  async function request<T>(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${h.base}/api/v1/${path}`, { method, headers: { authorization: `Bearer ${h.adminToken}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `API ${path} phải thành công, status ${response.status}`);
    return await response.json() as T;
  }
  try {
    for (const [index, record] of sample.records.entries()) {
      const total = scores[index]!;
      for (const [criterionId, selfScore] of [[sample.leaf1, Math.min(60, total)], [sample.leaf2, Math.max(0, Math.round((total - 60) * 100) / 100)]] as const) {
        assert.equal((await h.request("PUT", `evaluations/${record.evaluationId}/scores/${criterionId}/self`, record.token, { selfScore, selfNote: "Đối chiếu biên ngưỡng" })).status, 200);
      }
      const summary = await request<{ suggestedRating: string }>(`evaluations/${record.evaluationId}/score-summary`);
      assert.equal(summary.suggestedRating, expected[index]);
      const rows = await h.prisma.$queryRawUnsafe<{ suggested_rating: string }[]>("SELECT suggested_rating FROM v_evaluation_totals WHERE evaluation_id=$1::uuid", record.evaluationId);
      assert.equal(rows[0]!.suggested_rating, expected[index]);
      assert.equal((await h.request("POST", `evaluations/${record.evaluationId}/submit`, record.token, {})).status, 200);
    }
    await h.prisma.evaluationPeriod.update({ where: { id: sample.periodId }, data: { phase: "FIRST_REVIEW", selfEvalDeadline: new Date(Date.now() - 1000) } });
    for (const record of sample.records) await h.firstReview(record.evaluationId);
    await request(`evaluation-periods/${sample.periodId}/transition-phase`, "POST", { phase: "FINAL_REVIEW" });
    for (const [index, record] of sample.records.entries()) {
      const final = await request<{ finalRating: string }>(`admin/evaluations/${record.evaluationId}/finalize`, "POST", {});
      assert.equal(final.finalRating, expected[index]);
    }
    const ranking = await request<{ items: { evaluationId: string; suggestedRating: string }[] }>(`admin/dashboard/leaderboard?periodId=${sample.periodId}`);
    for (const [index, record] of sample.records.entries()) assert.equal(ranking.items.find((row) => row.evaluationId === record.evaluationId)?.suggestedRating, expected[index]);
    const configuration = ["EXCELLENT", "GOOD", "PASS", "FAIL"].map((rating, index) => ({ rating, label: rating, minPercent: [85, 65, 50, 0][index], minExclusive: index === 0 }));
    assert.equal((await h.request("PUT", `evaluation-periods/${sample.periodId}/thresholds`, h.adminToken, configuration)).status, 400);

    for (const format of ["XLSX", "PDF", "DOCX"] as const) {
      const metadata = await request<{ downloadUrl: string }>("admin/reports/exports", "POST", { periodId: sample.periodId, reportType: format === "XLSX" ? "SUMMARY_ALL_UNITS" : "UNIT_APPRAISAL_MINUTES", format, ...(format === "XLSX" ? {} : { evaluationId: sample.records.at(-1)!.evaluationId }) });
      const response = await fetch(`${h.base}${metadata.downloadUrl}`, { headers: { authorization: `Bearer ${h.adminToken}` } });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (format === "XLSX") {
        const book = await readReportExcel(bytes); const text = JSON.stringify(book.getWorksheet("Tổng hợp")!.getSheetValues());
        for (const label of new Set(labels)) assert.ok(text.includes(label));
        const legend = JSON.stringify(book.getWorksheet("Chú giải")!.getSheetValues());
        assert.match(legend, /90/); assert.match(legend, /70/); assert.match(legend, /45/);
      } else if (format === "PDF") assert.match((await readReportPdf(bytes)).text, /Xuất sắc/u);
      else assert.match(await readReportWord(bytes), /Xuất sắc/u);
    }
  } finally { await h.app.close(); }
});
