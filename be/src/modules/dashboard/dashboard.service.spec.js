import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.ts";
import { DashboardService } from "./dashboard.service.ts";

const period = {
  id: "11111111-1111-4111-8111-111111111111",
  year: 2026,
  name: "Đợt thi đua năm 2026",
  phase: "FIRST_REVIEW",
  maxTotalScore: new Prisma.Decimal(300),
};

/** Tạo Prisma stub tối thiểu để kiểm công thức và shape; HTTP/PostgreSQL được kiểm ở bộ VC14 riêng */
function makeService(overrides = {}) {
  const calls = { criterionScoreFindMany: [] };
  const prisma = {
    evaluationPeriod: {
      findUnique: async () => period,
    },
    evaluation: {
      count: async () => 2,
      findMany: async () => [{ finalPercent: new Prisma.Decimal(90) }, { finalPercent: new Prisma.Decimal(80) }],
      groupBy: async ({ by }) => {
        if (by[0] === "status") {
          return [
            { status: "DRAFT", _count: { _all: 2 } },
            { status: "PENDING_REVIEW", _count: { _all: 4 } },
            { status: "SUPPLEMENT_REQUESTED", _count: { _all: 1 } },
            { status: "SUPPLEMENT_SUBMITTED", _count: { _all: 1 } },
            { status: "FINALIZED", _count: { _all: 2 } },
          ];
        }

        return [
          { finalRating: "EXCELLENT", _count: { _all: 1 } },
          { finalRating: "GOOD", _count: { _all: 1 } },
        ];
      },
      aggregate: async () => ({
        _count: { _all: 2 },
        _sum: { finalScore: new Prisma.Decimal(510) },
        _avg: {
          finalScore: new Prisma.Decimal(255),
          finalPercent: new Prisma.Decimal(85),
        },
      }),
    },
    ratingThreshold: {
      findMany: async () => [
        { rating: "EXCELLENT", label: "Xuất sắc", color: "#16a34a" },
        { rating: "GOOD", label: "Tốt", color: "#eab308" },
        { rating: "PASS", label: "Đạt", color: "#f97316" },
        { rating: "FAIL", label: "Không đạt", color: "#dc2626" },
      ],
    },
    criterionScore: {
      findMany: async (args) => {
        calls.criterionScoreFindMany.push(args);
        return [];
      },
    },
    leaderboard: {
      findMany: async () => [],
    },
    ...overrides.prisma,
  };

  return { service: new DashboardService(prisma), calls };
}

test("overview only uses finalized records for official results and rating distribution", async () => {
  const { service } = makeService();

  const result = await service.getOverview(period.id);

  assert.equal(result.totalUnits, 10);
  assert.equal(result.submittedCount, 7);
  assert.equal(result.notSubmittedCount, 2);
  assert.equal(result.supplementPendingCount, 1);
  assert.equal(result.progressPercent, 70);
  assert.equal(result.finalizedCount, 2);
  assert.equal(result.notFinalizedCount, 8);
  assert.deepEqual(result.officialResults, {
    totalFinalScore: 510,
    averageFinalScore: 255,
    averageFinalPercent: 85,
  });
  assert.deepEqual(result.scoreDistribution.items, [
    { rating: "EXCELLENT", label: "Xuất sắc", color: "#16a34a", count: 1, percent: 50 },
    { rating: "GOOD", label: "Tốt", color: "#eab308", count: 1, percent: 50 },
    { rating: "PASS", label: "Đạt", color: "#f97316", count: 0, percent: 0 },
    { rating: "FAIL", label: "Không đạt", color: "#dc2626", count: 0, percent: 0 },
  ]);
  // Hai điểm 80 và 90 thuộc hai bucket khác nhau, mọi bucket cộng lại bằng số đã chốt
  assert.deepEqual(result.scoreDistribution.buckets.map((bucket) => bucket.count), [0, 0, 1, 1]);
});

test("deductions only include positive deductions from finalized evaluations", async () => {
  const { service, calls } = makeService({
    prisma: {
      criterionScore: {
        findMany: async (args) => {
          calls.criterionScoreFindMany.push(args);
          return [
            {
              criterionId: "criterion-a",
              selfScore: new Prisma.Decimal(10),
              adminScore: new Prisma.Decimal(8.25),
              criterion: { code: "A1", name: "Tiêu chí A", sortOrder: 2 },
            },
            {
              criterionId: "criterion-a",
              selfScore: new Prisma.Decimal(5),
              adminScore: new Prisma.Decimal(5),
              criterion: { code: "A1", name: "Tiêu chí A", sortOrder: 2 },
            },
            {
              criterionId: "criterion-b",
              selfScore: new Prisma.Decimal(7),
              adminScore: new Prisma.Decimal(3),
              criterion: { code: "B1", name: "Tiêu chí B", sortOrder: 1 },
            },
          ];
        },
      },
    },
  });

  const result = await service.getDeductions(period.id);

  assert.deepEqual(result.items, [
    {
      criterionId: "criterion-b",
      code: "B1",
      name: "Tiêu chí B",
      unitsDeducted: 1,
      totalPointsDeducted: 4,
    },
    {
      criterionId: "criterion-a",
      code: "A1",
      name: "Tiêu chí A",
      unitsDeducted: 1,
      totalPointsDeducted: 1.75,
    },
  ]);
  assert.equal(calls.criterionScoreFindMany.length, 1);
  assert.equal(
    calls.criterionScoreFindMany[0].where.evaluation.status,
    "FINALIZED",
  );
});

test("leaderboard returns current scores from the view ordered by rank", async () => {
  const calls = [];
  const { service } = makeService({
    prisma: {
      leaderboard: {
        findMany: async (args) => {
          calls.push(args);
          return [
            {
              rank: 1n,
              scoreRank: 1n,
              evaluationId: "evaluation-a",
              unitId: "unit-a",
              unitCode: "DV001",
              unitName: "Đơn vị A",
              status: "PENDING_REVIEW",
              submittedAt: new Date("2026-01-15T08:00:00.000Z"),
              maxTotalScore: new Prisma.Decimal(300),
              selfTotal: new Prisma.Decimal(280),
              currentTotal: new Prisma.Decimal(285.25),
              currentPercent: new Prisma.Decimal(95.0833),
              suggestedRating: "EXCELLENT",
            },
            {
              rank: 2n,
              scoreRank: 1n,
              evaluationId: "evaluation-b",
              unitId: "unit-b",
              unitCode: "DV002",
              unitName: "Đơn vị B",
              status: "DRAFT",
              submittedAt: null,
              maxTotalScore: new Prisma.Decimal(300),
              selfTotal: new Prisma.Decimal(285.25),
              currentTotal: new Prisma.Decimal(285.25),
              currentPercent: new Prisma.Decimal(95.0833),
              suggestedRating: null,
            },
          ];
        },
      },
    },
  });

  const result = await service.getLeaderboard(period.id);

  assert.deepEqual(result, {
    periodId: period.id,
    totalUnits: 2,
    items: [
      {
        rank: 1,
        scoreRank: 1,
        evaluationId: "evaluation-a",
        unitId: "unit-a",
        unitCode: "DV001",
        unitName: "Đơn vị A",
        status: "PENDING_REVIEW",
        submittedAt: "2026-01-15T08:00:00.000Z",
        maxTotalScore: 300,
        selfTotal: 280,
        currentTotal: 285.25,
        currentPercent: 95.08,
        suggestedRating: "EXCELLENT",
        ratingLabel: "Xuất sắc",
        ratingColor: "#16a34a",
        isFinal: false,
      },
      {
        rank: 2,
        scoreRank: 1,
        evaluationId: "evaluation-b",
        unitId: "unit-b",
        unitCode: "DV002",
        unitName: "Đơn vị B",
        status: "DRAFT",
        submittedAt: null,
        maxTotalScore: 300,
        selfTotal: 285.25,
        currentTotal: 285.25,
        currentPercent: 95.08,
        suggestedRating: null,
        ratingLabel: null,
        ratingColor: null,
        isFinal: false,
      },
    ],
  });
  assert.deepEqual(calls[0].where, { periodId: period.id });
  assert.deepEqual(calls[0].orderBy, { rank: "asc" });
  assert.equal(calls[0].take, 20);
});

/** Kỳ rỗng không tạo phép chia 0 và không buộc view trả dòng giả */
test("leaderboard returns an empty list when its period has no evaluations", async () => {
  const { service } = makeService({ prisma: { evaluation: { count: async () => 0, findMany: async () => [], groupBy: async () => [], aggregate: async () => ({ _count: { _all: 0 }, _sum: { finalScore: null }, _avg: { finalScore: null, finalPercent: null } }) } } });

  const result = await service.getLeaderboard(period.id);

  assert.deepEqual(result, { periodId: period.id, totalUnits: 0, items: [] });
  const overview = await service.getOverview(period.id);
  assert.equal(overview.progressPercent, 0);
  assert.equal(overview.totalUnits, 0);
  assert.deepEqual(overview.scoreDistribution.buckets.map((bucket) => bucket.count), [0, 0, 0, 0]);
});

/** Rank vượt giới hạn JSON an toàn phải là chuỗi, limit sai bị chặn trước khi truy vấn */
test("leaderboard serializes large ranks safely and rejects invalid limits", async () => {
  const { service } = makeService({ prisma: { leaderboard: { findMany: async () => [{ rank: 9007199254740992n, scoreRank: 9007199254740992n, status: "FINALIZED", suggestedRating: "PASS", maxTotalScore: new Prisma.Decimal(100), selfTotal: new Prisma.Decimal(50), currentTotal: new Prisma.Decimal(50), currentPercent: new Prisma.Decimal(50) }] } } });
  const result = await service.getLeaderboard(period.id, 1);
  assert.equal(result.items[0].rank, "9007199254740992");
  assert.equal(result.items[0].scoreRank, "9007199254740992");
  assert.equal(result.items[0].ratingLabel, "Đạt");
  assert.equal(result.items[0].isFinal, true);
  await assert.rejects(() => service.getLeaderboard(period.id, 101));
});
