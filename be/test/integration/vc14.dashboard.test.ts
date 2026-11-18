import assert from "node:assert/strict";
import { test } from "node:test";
import { createVc12Harness } from "./vc12-support.js";

interface DashboardResponse {
  periodId: string; totalUnits: number; submittedCount: number; notSubmittedCount: number; supplementPendingCount: number;
  progressPercent: number; finalizedCount: number; statusCounts: Record<string, number>;
  items: { criterionId: string; evaluationId: string; rank: number | string; scoreRank: number | string; suggestedRating: string | null; ratingLabel: string | null; isFinal: boolean; unitsDeducted: number; totalPointsDeducted: number; pointsDeducted: number }[];
  buckets: { count: number }[]; officialResults: { totalFinalScore: number };
}

/** Khởi động Nest trên PostgreSQL VC14 riêng và kiểm bốn API bằng dữ liệu có kết quả biết trước
 * Fixture dùng UUID mới, không reset DB và tắt provider để không gửi tới người nhận thật
 */
test("VC14 dashboard, xếp hạng và phổ điểm trên HTTP/PostgreSQL", async () => {
  const h = await createVc12Harness({ url: process.env.VC14_TEST_DATABASE_URL, name: "vc14_test" });
  /** Giữ status và cache header để kiểm quyền, không in token hoặc lỗi driver */
  async function get(path: string, token = h.adminToken) {
    const response = await fetch(`${h.base}/api/v1/${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() as DashboardResponse };
  }
  try {
    const sample = await h.scenario(3, 100, [50, 35]);
    const other = await h.scenario(1, 100, [40, 20]);
    const path = (suffix = "") => `admin/dashboard${suffix}?periodId=${sample.periodId}`;
    assert.equal((await get(path(), sample.records[0].token)).status, 403);
    assert.equal((await get(`admin/dashboard?periodId=sai`)).status, 400);
    assert.equal((await get(path("/leaderboard") + "&limit=0")).status, 400);
    assert.equal((await get(path("/leaderboard") + "&limit=2abc")).status, 400);

    /** Chấm thấp một ô trước khi hoàn tất lượt đầu; hồ sơ còn lại giữ điểm hòa để kiểm scoreRank */
    assert.equal((await h.request("PUT", `admin/evaluations/${sample.records[1].evaluationId}/scores/${sample.leaf1}/review`, h.adminToken, { adminScore: 10, adminComment: "Thiếu minh chứng hợp lệ" })).status, 200);
    await h.firstReview(sample.records[0].evaluationId);
    await h.firstReview(sample.records[1].evaluationId);
    // Kỳ fixture chuyển sang pha thẩm định cuối sau khi đã hoàn tất lượt đầu, đúng điều kiện API chốt
    await h.prisma.evaluationPeriod.update({ where: { id: sample.periodId }, data: { phase: "FINAL_REVIEW" } });
    for (const row of sample.records.slice(0, 2)) {
      const result = await h.request("POST", `admin/evaluations/${row.evaluationId}/finalize`, h.adminToken, {});
      assert.equal(result.status, 200, JSON.stringify(result.body));
    }

    const overview = await get(path());
    assert.equal(overview.status, 200); assert.equal(overview.cache, "no-store");
    assert.equal(overview.body.totalUnits, 3); assert.equal(overview.body.submittedCount, 3);
    assert.equal(overview.body.finalizedCount, 2); assert.equal(overview.body.officialResults.totalFinalScore, 130);
    assert.equal(Object.values(overview.body.statusCounts).reduce((sum, count) => sum + count, 0), overview.body.totalUnits);
    const ranking = await get(path("/leaderboard") + "&limit=2");
    assert.equal(ranking.status, 200); assert.equal(ranking.body.totalUnits, 3); assert.equal(ranking.body.items.length, 2);
    assert.equal(ranking.body.items[0].scoreRank, ranking.body.items[1].scoreRank);
    assert.ok(ranking.body.items.some((item) => !item.isFinal));
    assert.equal((await get(`admin/dashboard/leaderboard?periodId=${other.periodId}`)).body.totalUnits, 1);
    const distribution = await get(path("/score-distribution"));
    assert.equal(distribution.body.finalizedCount, 2);
    assert.deepEqual(distribution.body.buckets.map((bucket) => bucket.count), [1, 0, 1, 0]);
    const deductions = await get(path("/criteria-deductions"));
    assert.equal(deductions.body.items[0].unitsDeducted, 1);
    assert.equal(deductions.body.items[0].totalPointsDeducted, 40);
    const detail = await get(`admin/dashboard/criteria-deductions/${deductions.body.items[0].criterionId}?periodId=${sample.periodId}`);
    assert.equal(detail.status, 200); assert.equal(detail.cache, "no-store");
    assert.equal(detail.body.items.length, 1);
    assert.equal(detail.body.items[0].evaluationId, sample.records[1].evaluationId);
    assert.equal(detail.body.items[0].pointsDeducted, 40);
    assert.equal((await get(`admin/dashboard/criteria-deductions/${sample.leaf1}?periodId=${other.periodId}`)).status, 404);
    assert.equal((await get(`admin/dashboard/criteria-deductions/sai-ma?periodId=${sample.periodId}`)).status, 400);
    assert.equal((await get(`admin/dashboard/criteria-deductions/${sample.leaf1}?periodId=${sample.periodId}`, sample.records[0].token)).status, 403);
  } finally {
    await h.app.close();
  }
});
