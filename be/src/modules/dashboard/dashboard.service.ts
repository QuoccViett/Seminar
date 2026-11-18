import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ERROR_CODES } from "../../common/constants/error-codes.js";
import { decimal, toApiNumber } from "../../common/utils/decimal.util.js";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type {
  DashboardPeriodDto,
  EvaluationStatusCountsDto,
  ScoreDistributionDto,
  ScoreDistributionItemDto,
} from "./dto/dashboard-overview.dto.js";
import type { LeaderboardItemDto } from "./dto/leaderboard.dto.js";

const EVALUATION_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "SUPPLEMENT_REQUESTED",
  "SUPPLEMENT_SUBMITTED",
  "SUPPLEMENT_EXPIRED",
  "FINALIZED",
] as const;

type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

type DeductionAggregate = {
  criterionId: string;
  code: string;
  name: string;
  sortOrder: number;
  unitsDeducted: number;
  totalPointsDeducted: Prisma.Decimal;
};

@Injectable()
export class DashboardService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService
  ) {}

  /** Tổng hợp hồ sơ theo trạng thái trong một kỳ UUID
   * Kết quả chính thức chỉ lấy FINALIZED; ba nhóm tiến độ loại trừ nhau và kỳ rỗng có tiến độ 0
   * Không lấy số đơn vị hệ thống vì chỉ hồ sơ đã tạo cho kỳ mới thuộc mẫu số
   */
  async getOverview(periodId: string) {
    const period = await this.findPeriodOrThrow(periodId);
    const [statusGroups, officialResults, scoreDistribution] = await Promise.all([
      this.prisma.evaluation.groupBy({
        by: ["status"],
        where: { periodId },
        _count: { _all: true },
      }),
      this.prisma.evaluation.aggregate({
        where: { periodId, status: "FINALIZED" },
        _count: { _all: true },
        _sum: { finalScore: true },
        _avg: { finalScore: true, finalPercent: true },
      }),
      this.getScoreDistributionForPeriod(periodId),
    ]);
    const statusCounts = this.createStatusCounts(statusGroups);
    const totalUnits = this.sumStatusCounts(statusCounts);
    const finalizedCount = officialResults._count._all;
    // Hồ sơ đang chờ bổ sung chưa tính vào nhóm đã nộp để ba nhóm tiến độ không chồng nhau
    const supplementPendingCount = statusCounts.SUPPLEMENT_REQUESTED;
    const submittedCount = totalUnits - statusCounts.DRAFT - supplementPendingCount;

    return {
      periodId,
      period: this.toPeriodDto(period),
      totalUnits,
      statusCounts,
      submittedCount,
      notSubmittedCount: statusCounts.DRAFT,
      supplementPendingCount,
      progressPercent: this.calculatePercent(submittedCount, totalUnits),
      finalizedCount,
      notFinalizedCount: totalUnits - finalizedCount,
      officialResults: {
        totalFinalScore: toApiNumber(officialResults._sum.finalScore) ?? 0,
        averageFinalScore: toApiNumber(officialResults._avg.finalScore) ?? 0,
        averageFinalPercent: toApiNumber(officialResults._avg.finalPercent) ?? 0,
      },
      scoreDistribution,
    };
  }

  /** Cộng chênh lệch dương theo tiêu chí trên hồ sơ đã chốt
   * Bỏ ô chưa có đủ hai điểm, ô không bị trừ và hồ sơ còn thẩm định để tránh báo sai điểm yếu
   * Dùng Decimal đến bước serialize để tổng điểm không bị sai do số thực JavaScript
   */
  async getDeductions(periodId: string) {
    await this.findPeriodOrThrow(periodId);
    const scores = await this.prisma.criterionScore.findMany({
      where: {
        evaluation: { periodId, status: "FINALIZED" },
        criterion: { periodId },
        selfScore: { not: null },
        adminScore: { not: null },
      },
      select: {
        criterionId: true,
        selfScore: true,
        adminScore: true,
        criterion: {
          select: {
            code: true,
            name: true,
            sortOrder: true,
          },
        },
      },
    });
    const deductions = new Map<string, DeductionAggregate>();

    for (const score of scores) {
      if (score.selfScore === null || score.adminScore === null) {
        continue;
      }

      const selfScore = decimal(score.selfScore);
      const adminScore = decimal(score.adminScore);
      const pointsDeducted = selfScore.minus(adminScore);

      if (pointsDeducted.lessThanOrEqualTo(0)) {
        continue;
      }

      const current = deductions.get(score.criterionId);

      if (current) {
        current.unitsDeducted += 1;
        current.totalPointsDeducted = current.totalPointsDeducted.plus(pointsDeducted);
        continue;
      }

      deductions.set(score.criterionId, {
        criterionId: score.criterionId,
        code: score.criterion.code,
        name: score.criterion.name,
        sortOrder: score.criterion.sortOrder,
        unitsDeducted: 1,
        totalPointsDeducted: pointsDeducted,
      });
    }

    const items = [...deductions.values()]
      .sort((left, right) => {
        const comparison = right.totalPointsDeducted.comparedTo(
          left.totalPointsDeducted,
        );

        if (comparison !== 0) {
          return comparison;
        }

        if (right.unitsDeducted !== left.unitsDeducted) {
          return right.unitsDeducted - left.unitsDeducted;
        }

        return left.sortOrder - right.sortOrder || left.criterionId.localeCompare(right.criterionId);
      })
      .map((deduction) => ({
        criterionId: deduction.criterionId,
        code: deduction.code,
        name: deduction.name,
        unitsDeducted: deduction.unitsDeducted,
        totalPointsDeducted: toApiNumber(deduction.totalPointsDeducted) ?? 0,
      }));

    return { periodId, items };
  }

  /** Giải thích tổng điểm trừ bằng từng hồ sơ đã chốt của đúng tiêu chí trong kỳ
   * Kiểm quan hệ kỳ trước khi đọc để ID tiêu chí khác kỳ không lộ thông tin
   * Ô chưa thẩm định, điểm bằng nhau hoặc Admin cho thêm điểm không thuộc drill-down
   */
  async getDeductionDetail(periodId: string, criterionId: string) {
    await this.findPeriodOrThrow(periodId);
    const criterion = await this.prisma.criterion.findFirst({ where: { id: criterionId, periodId }, select: { id: true } });
    if (!criterion) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Không tìm thấy tiêu chí trong kỳ đánh giá" });
    }
    const scores = await this.prisma.criterionScore.findMany({
      where: { criterionId, evaluation: { periodId, status: "FINALIZED" }, selfScore: { not: null }, adminScore: { not: null } },
      select: { selfScore: true, adminScore: true, evaluation: { select: { id: true, unit: { select: { id: true, code: true, name: true } } } } },
    });
    const items = scores.flatMap((score) => {
      if (score.selfScore === null || score.adminScore === null) return [];
      const points = decimal(score.selfScore).minus(decimal(score.adminScore));
      if (points.lessThanOrEqualTo(0)) return [];
      return [{ evaluationId: score.evaluation.id, unitId: score.evaluation.unit.id, unitCode: score.evaluation.unit.code, unitName: score.evaluation.unit.name, selfScore: toApiNumber(score.selfScore) ?? 0, adminScore: toApiNumber(score.adminScore) ?? 0, pointsDeducted: toApiNumber(points) ?? 0 }];
    }).sort((left, right) => right.pointsDeducted - left.pointsDeducted || left.unitCode.localeCompare(right.unitCode) || left.evaluationId.localeCompare(right.evaluationId));
    return { periodId, criterionId, items };
  }

  /** Đọc phổ điểm theo loại và bucket của kỳ, chỉ từ điểm cuối đã được chốt */
  async getScoreDistribution(periodId: string) {
    await this.findPeriodOrThrow(periodId);
    const distribution = await this.getScoreDistributionForPeriod(periodId);

    return { periodId, ...distribution };
  }

  /** Giới hạn số dòng nhưng giữ tổng hồ sơ toàn kỳ và thứ hạng do view SQL tính trên tất cả đơn vị
   * limit mặc định 20 và chỉ nhận 1 đến 100; ngưỡng lấy theo periodId để label không lệch kỳ
   * Bản ghi chưa FINALIZED được đánh dấu tạm tính dù đã có điểm và gợi ý xếp loại
   */
  async getLeaderboard(periodId: string, limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: "Giới hạn bảng xếp hạng phải từ 1 đến 100" });
    }
    await this.findPeriodOrThrow(periodId);
    const [items, totalUnits, thresholds] = await Promise.all([
      this.prisma.leaderboard.findMany({
        where: { periodId },
        orderBy: { rank: "asc" },
        take: limit,
        select: {
          rank: true,
          scoreRank: true,
          evaluationId: true,
          unitId: true,
          unitCode: true,
          unitName: true,
          status: true,
          submittedAt: true,
          maxTotalScore: true,
          selfTotal: true,
          currentTotal: true,
          currentPercent: true,
          suggestedRating: true,
        },
      }),
      this.prisma.evaluation.count({ where: { periodId } }),
      this.prisma.ratingThreshold.findMany({ where: { periodId }, select: { rating: true, label: true, color: true } }),
    ]);
    const ratingByCode = new Map(thresholds.map((threshold) => [threshold.rating, threshold]));

    return {
      periodId,
      totalUnits,
      items: items.map((item) => {
        const rating = item.suggestedRating ? ratingByCode.get(item.suggestedRating) : null;
        return { ...this.toLeaderboardItemDto(item), ratingLabel: rating?.label ?? null, ratingColor: rating?.color ?? null, isFinal: item.status === "FINALIZED" };
      }),
    };
  }

  /** Xác nhận kỳ tồn tại trước các truy vấn con để mọi route trả 404 có câu tiếng Việt thống nhất */
  private async findPeriodOrThrow(periodId: string) {
    const period = await this.prisma.evaluationPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        year: true,
        name: true,
        phase: true,
        maxTotalScore: true,
      },
    });

    if (!period) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: "Không tìm thấy đợt đánh giá",
      });
    }

    return period;
  }

  /** Chuyển Decimal và BigInt từ view sang JSON; giá trị vắng mặt giữ shape ổn định */
  private toLeaderboardItemDto(item: {
    rank: bigint | null;
    scoreRank: bigint | null;
    evaluationId: string | null;
    unitId: string | null;
    unitCode: string | null;
    unitName: string | null;
    status: string | null;
    submittedAt: Date | null;
    maxTotalScore: Parameters<typeof toApiNumber>[0];
    selfTotal: Parameters<typeof toApiNumber>[0];
    currentTotal: Parameters<typeof toApiNumber>[0];
    currentPercent: Parameters<typeof toApiNumber>[0];
    suggestedRating: string | null;
  }): LeaderboardItemDto {
    return {
      rank: this.safeRank(item.rank),
      scoreRank: this.safeRank(item.scoreRank),
      evaluationId: item.evaluationId ?? "",
      unitId: item.unitId ?? "",
      unitCode: item.unitCode ?? "",
      unitName: item.unitName ?? "",
      status: item.status ?? "",
      submittedAt: item.submittedAt?.toISOString() ?? null,
      maxTotalScore: toApiNumber(item.maxTotalScore) ?? 0,
      selfTotal: toApiNumber(item.selfTotal) ?? 0,
      currentTotal: toApiNumber(item.currentTotal) ?? 0,
      currentPercent: toApiNumber(item.currentPercent) ?? 0,
      suggestedRating: item.suggestedRating,
      ratingLabel: null,
      ratingColor: null,
      isFinal: item.status === "FINALIZED",
    };
  }

  /** Phân nhóm phần trăm theo ranh giới nghiệp vụ và số hồ sơ đã chốt
   * 85 thuộc bucket trước vì EXCELLENT yêu cầu lớn hơn 85, kỳ chưa chốt trả toàn số không
   */
  private async getScoreDistributionForPeriod(
    periodId: string,
  ): Promise<ScoreDistributionDto> {
    const [thresholds, ratingGroups, finalPercents] = await Promise.all([
      this.prisma.ratingThreshold.findMany({
        where: { periodId },
        orderBy: { minPercent: "desc" },
        select: {
          rating: true,
          label: true,
          color: true,
        },
      }),
      this.prisma.evaluation.groupBy({
        by: ["finalRating"],
        where: { periodId, status: "FINALIZED" },
        _count: { _all: true },
      }),
      this.prisma.evaluation.findMany({ where: { periodId, status: "FINALIZED" }, select: { finalPercent: true } }),
    ]);
    const countByRating = new Map<string, number>();

    for (const group of ratingGroups) {
      if (group.finalRating) {
        countByRating.set(group.finalRating, group._count._all);
      }
    }

    const finalizedCount = [...countByRating.values()].reduce(
      (total, count) => total + count,
      0,
    );
    const configuredRatings = new Set(
      thresholds.map((threshold) => threshold.rating),
    );
    const configuredItems = thresholds.map((threshold) => {
      const count = countByRating.get(threshold.rating) ?? 0;

      return {
        rating: threshold.rating,
        label: threshold.label,
        color: threshold.color,
        count,
        percent: this.calculatePercent(count, finalizedCount),
      } satisfies ScoreDistributionItemDto;
    });
    const unconfiguredItems = [...countByRating.entries()]
      .filter(([rating]) => !configuredRatings.has(rating))
      .sort(([leftRating], [rightRating]) =>
        leftRating.localeCompare(rightRating),
      )
      .map(([rating, count]) => ({
        rating,
        label: rating,
        color: null,
        count,
        percent: this.calculatePercent(count, finalizedCount),
      } satisfies ScoreDistributionItemDto));

    // Mốc 85 thuộc bucket 65–85; chỉ trên 85 mới thuộc bucket cuối theo quy tắc xếp loại
    const buckets = [
      { key: "0-50", label: "Dưới 50%", count: 0 },
      { key: "50-65", label: "Từ 50% đến dưới 65%", count: 0 },
      { key: "65-85", label: "Từ 65% đến 85%", count: 0 },
      { key: "85-100", label: "Trên 85%", count: 0 },
    ];
    for (const row of finalPercents) {
      const value = decimal(row.finalPercent ?? 0);
      const index = value.lessThan(50) ? 0 : value.lessThan(65) ? 1 : value.lessThanOrEqualTo(85) ? 2 : 3;
      buckets[index].count += 1;
    }
    return { finalizedCount, items: [...configuredItems, ...unconfiguredItems], buckets: buckets.map((bucket) => ({ ...bucket, percent: this.calculatePercent(bucket.count, finalizedCount) })) };
  }

  private createStatusCounts(
    groups: { status: string; _count: { _all: number } }[],
  ): EvaluationStatusCountsDto {
    const counts = EVALUATION_STATUSES.reduce(
      (result, status) => ({ ...result, [status]: 0 }),
      {} as EvaluationStatusCountsDto,
    );

    for (const group of groups) {
      if (this.isEvaluationStatus(group.status)) {
        counts[group.status] = group._count._all;
      }
    }

    return counts;
  }

  private sumStatusCounts(counts: EvaluationStatusCountsDto): number {
    return EVALUATION_STATUSES.reduce(
      (total, status) => total + counts[status],
      0,
    );
  }

  private toPeriodDto(period: {
    id: string;
    year: number;
    name: string;
    phase: string;
    maxTotalScore: Parameters<typeof toApiNumber>[0];
  }): DashboardPeriodDto {
    return {
      ...period,
      maxTotalScore: toApiNumber(period.maxTotalScore) ?? 0,
    };
  }

  private isEvaluationStatus(status: string): status is EvaluationStatus {
    return EVALUATION_STATUSES.includes(status as EvaluationStatus);
  }

  private calculatePercent(value: number, total: number): number {
    return total === 0 ? 0 : this.round((value / total) * 100);
  }

  /** Chỉ ép BigInt sang number trong miền chính xác của JSON, còn lại giữ chuỗi thập phân */
  private safeRank(value: bigint | null): number | string {
    const rank = value ?? 0n;
    return rank <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rank) : rank.toString();
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
