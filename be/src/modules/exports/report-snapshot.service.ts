import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Criterion, type RatingThreshold } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateReportExportDto } from "./dto/create-report-export.dto.js";
import type { AppraisalReportData, ReportPeriodData, SummaryReportData } from "./generators/report-data.js";

type Score = { criterionId: string; selfScore: Prisma.Decimal | null; adminScore: Prisma.Decimal | null };
type Snapshot = { type: "summary"; data: SummaryReportData } | { type: "appraisal"; data: AppraisalReportData };

/** Đọc một ảnh dữ liệu nhất quán để generator không ghép điểm trước và sau một lần thẩm định
 * Transaction chỉ đọc, không thay lịch hay reconcile trạng thái bằng tác dụng phụ của việc xuất
 */
@Injectable()
export class ReportSnapshotService {
  /** Nhận Prisma dùng chung, mọi query của một lần xuất đi qua cùng transaction RepeatableRead */
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Tính tổng chỉ từ lá bằng Decimal và so ngưỡng trước khi làm tròn phần trăm
   * Điểm không được giữ nguyên, null mới fallback sang tự chấm; max bằng không tránh phép chia lỗi
   */
  private totals(scores: Score[], leafIds: Set<string>, maximum: Prisma.Decimal, thresholds: RatingThreshold[]) {
    const selected = scores.filter((score) => leafIds.has(score.criterionId));
    const self = selected.reduce((sum, score) => sum.add(score.selfScore ?? 0), new Prisma.Decimal(0));
    const current = selected.reduce((sum, score) => sum.add(score.adminScore ?? score.selfScore ?? 0), new Prisma.Decimal(0));
    const rating = [...thresholds].sort((a, b) => b.minPercent.comparedTo(a.minPercent)).find((item) => {
      const comparison = current.mul(100).comparedTo(item.minPercent.mul(maximum));
      return maximum.gt(0) && (item.minExclusive ? comparison > 0 : comparison >= 0);
    });
    return { selfTotal: self.toNumber(), currentTotal: current.toNumber(), currentPercent: maximum.gt(0) ? current.mul(100).div(maximum).toDecimalPlaces(2).toNumber() : 0, currentRatingLabel: rating?.label ?? null };
  }

  /** Chuyển cây tiêu chí thành thứ tự duyệt trước, giữ nhóm làm tiêu đề và kiểm dữ liệu chu trình
   * Sắp theo sortOrder, code và ID từ truy vấn để các tệp cùng snapshot có thứ tự xác định
   */
  private ordered(criteria: Criterion[]) {
    const result: { criterion: Criterion; depth: number }[] = [];
    const visited = new Set<string>();
    const children = new Map<string | null, Criterion[]>();
    for (const criterion of criteria) children.set(criterion.parentId, [...(children.get(criterion.parentId) ?? []), criterion]);
    /** Duyệt nhóm con theo thứ tự DB và không đi lại một nút dù dữ liệu cũ có chu trình */
    const walk = (parentId: string | null, depth: number): void => {
      for (const criterion of children.get(parentId) ?? []) {
        if (visited.has(criterion.id)) continue;
        visited.add(criterion.id); result.push({ criterion, depth }); walk(criterion.id, depth + 1);
      }
    };
    walk(null, 0);
    if (result.length !== criteria.length) throw new BadRequestException({ code: "BUSINESS_RULE_VIOLATION", message: "Cây tiêu chí chưa hợp lệ để xuất báo cáo" });
    return result;
  }

  /** Đọc kỳ và hồ sơ cùng phạm vi, không dùng danh mục đơn vị toàn hệ thống làm danh sách của kỳ
   * Mốc quá hạn được trình bày theo giờ server dù scheduler chưa cập nhật trạng thái lưu trữ
   * Chỉ chọn tham chiếu minh chứng công khai và các field baseline đã biết, không trả JSON hay path thô
   */
  async read(dto: CreateReportExportDto, actorId: string): Promise<Snapshot> {
    return this.prisma.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const period = await tx.evaluationPeriod.findUnique({ where: { id: dto.periodId }, include: { ratingThresholds: { orderBy: { minPercent: "desc" } }, criteria: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }] } } });
      if (!period) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy kỳ đánh giá" });
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { fullName: true } });
      const data: ReportPeriodData = {
        id: period.id, year: period.year, name: period.name, phase: period.phase, maxTotalScore: period.maxTotalScore.toNumber(),
        generatedAt: clock.now, createdByName: actor?.fullName ?? "Quản trị viên",
        thresholds: period.ratingThresholds.map((item) => ({ rating: item.rating, label: item.label, color: item.color, minPercent: item.minPercent.toNumber(), minExclusive: item.minExclusive })),
      };
      const parents = new Set(period.criteria.flatMap((item) => item.parentId ? [item.parentId] : []));
      const leaves = new Set(period.criteria.filter((item) => !parents.has(item.id)).map((item) => item.id));
      /** Chỉ chiếu trạng thái hiệu lực, không tự chốt hay đổi cửa sổ bổ sung của snapshot */
      const effectiveStatus = (evaluation: { status: string; supplementDeadline: Date | null }) => {
        if (evaluation.status === "SUPPLEMENT_REQUESTED" && evaluation.supplementDeadline && clock.now >= evaluation.supplementDeadline) return "SUPPLEMENT_EXPIRED";
        if (evaluation.status === "DRAFT" && period.publishedAt && period.selfEvalDeadline && clock.now >= period.selfEvalDeadline) return "PENDING_REVIEW";
        return evaluation.status;
      };
      if (dto.reportType === "SUMMARY_ALL_UNITS") {
        const evaluations = await tx.evaluation.findMany({ where: { periodId: period.id }, include: { unit: true, criterionScores: { select: { criterionId: true, selfScore: true, adminScore: true } } }, orderBy: [{ unit: { sortOrder: "asc" } }, { unit: { code: "asc" } }, { id: "asc" }] });
        return { type: "summary", data: { period: data, rows: evaluations.map((evaluation) => {
          const final = evaluation.status === "FINALIZED";
          const threshold = final ? period.ratingThresholds.find((item) => item.rating === evaluation.finalRating) : null;
          return { unitCode: evaluation.unit.code, unitName: evaluation.unit.name, evaluationStatus: effectiveStatus(evaluation), submittedAt: evaluation.submittedAt, finalizedAt: final ? evaluation.finalizedAt : null,
            ...this.totals(evaluation.criterionScores, leaves, period.maxTotalScore, period.ratingThresholds),
            finalScore: final ? evaluation.finalScore?.toNumber() ?? null : null, finalPercent: final ? evaluation.finalPercent?.toNumber() ?? null : null,
            finalRating: final ? evaluation.finalRating : null, ratingLabel: threshold?.label ?? null, ratingColor: threshold?.color ?? null };
        }) } };
      }
      const evaluation = await tx.evaluation.findUnique({ where: { id: dto.evaluationId! }, include: {
        unit: { select: { code: true, name: true } }, finalizedBy: { select: { fullName: true } },
        criterionScores: { include: { reviewedBy: { select: { fullName: true } }, evidences: { select: { id: true, fileName: true, description: true, kind: true, round: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } },
        feedbacks: { include: { author: { select: { fullName: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        statusHistories: { include: { actor: { select: { fullName: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      } });
      if (!evaluation) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy phiếu đánh giá" });
      if (evaluation.periodId !== period.id) throw new BadRequestException({ code: "BUSINESS_RULE_VIOLATION", message: "Phiếu đánh giá không thuộc kỳ đánh giá đã chọn" });
      const final = evaluation.status === "FINALIZED";
      const byCriterion = new Map(evaluation.criterionScores.map((score) => [score.criterionId, score]));
      return { type: "appraisal", data: {
        period: data, unit: evaluation.unit,
        evaluation: { id: evaluation.id, status: effectiveStatus(evaluation), submittedAt: evaluation.submittedAt, finalizedAt: final ? evaluation.finalizedAt : null,
          supplementRequestedAt: evaluation.supplementRequestedAt, supplementStartAt: evaluation.supplementStartAt, supplementDeadline: evaluation.supplementDeadline, supplementSubmittedAt: evaluation.supplementSubmittedAt,
          finalScore: final ? evaluation.finalScore?.toNumber() ?? null : null, finalPercent: final ? evaluation.finalPercent?.toNumber() ?? null : null,
          finalRating: final ? evaluation.finalRating : null, finalRatingLabel: final ? period.ratingThresholds.find((item) => item.rating === evaluation.finalRating)?.label ?? null : null,
          finalizedByName: final ? evaluation.finalizedBy?.fullName ?? null : null, ...this.totals(evaluation.criterionScores, leaves, period.maxTotalScore, period.ratingThresholds) },
        scores: this.ordered(period.criteria).map(({ criterion, depth }) => {
          const score = byCriterion.get(criterion.id);
          const isGroup = parents.has(criterion.id);
          const baseline = score?.supplementBaseline as { content?: { selfScore?: unknown; selfNote?: unknown; evidenceIds?: unknown }; review?: { adminScore?: unknown; adminComment?: unknown } } | null;
          return { code: criterion.code, name: criterion.name, depth, isGroup, maxScore: criterion.maxScore.toNumber(),
            selfScore: !isGroup ? score?.selfScore?.toNumber() ?? null : null, adminScore: !isGroup ? score?.adminScore?.toNumber() ?? null : null,
            currentScore: !isGroup ? (score?.adminScore ?? score?.selfScore)?.toNumber() ?? null : null,
            selfNote: score?.selfNote ?? null, adminComment: score?.adminComment ?? null, reviewerName: score?.reviewedBy?.fullName ?? null, reviewedAt: score?.reviewedAt ?? null,
            evidences: (score?.evidences ?? []).map((item) => ({ id: item.id, label: item.fileName ?? item.description ?? (item.kind === "LINK" ? "Liên kết ngoài" : "Tệp minh chứng"), round: item.round })),
            needsSupplement: score?.needsSupplement ?? false, supplementNote: score?.supplementNote ?? null, supplementedAt: score?.supplementedAt ?? null,
            baseline: baseline ? { selfScore: typeof baseline.content?.selfScore === "string" ? baseline.content.selfScore : null, selfNote: typeof baseline.content?.selfNote === "string" ? baseline.content.selfNote : null, adminScore: typeof baseline.review?.adminScore === "string" ? baseline.review.adminScore : null,
              adminComment: typeof baseline.review?.adminComment === "string" ? baseline.review.adminComment : null,
              evidenceIds: Array.isArray(baseline.content?.evidenceIds) ? baseline.content.evidenceIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)) : [] } : null };
        }),
        feedbacks: evaluation.feedbacks.map((item) => ({ type: item.type, content: item.content, authorName: item.author.fullName, createdAt: item.createdAt })),
        histories: evaluation.statusHistories.map((item) => ({ fromStatus: item.fromStatus, toStatus: item.toStatus, comment: item.comment, actorName: item.actor?.fullName ?? "Hệ thống", createdAt: item.createdAt })),
      } };
    }, { isolationLevel: "RepeatableRead", timeout: 30_000, maxWait: 10_000 });
  }
}
