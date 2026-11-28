import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { AuditService } from "../../common/services/audit.service.js";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter.js";
import { lockPeriod } from "../../common/services/period-lock.js";
import { DeadlineCalculator } from "../../common/services/deadline-calculator.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { EvaluationStateService } from "./evaluation-state.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { PeriodWorkflowService } from "../evaluation-periods/period-workflow.service.js";
import { captureSupplementBaseline } from "./review-policy.js";
import type { BatchFinalizeDto, BatchReviewDto, ReviewScoreDto, SupplementRequestDto } from "./dto/review.dto.js";

/** Thẩm định một lá từ snapshot đã khóa, ghi audit trong cùng giao dịch */
@Injectable()
export class ReviewService {
  /** Tiêm DB, audit và đồng bộ trạng thái dùng chung với scheduler */
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService, @Inject(EvaluationStateService) private readonly state: EvaluationStateService, @Inject(NotificationsService) private readonly notifications: NotificationsService, @Inject(DeadlineCalculator) private readonly deadlines: DeadlineCalculator, @Inject(PeriodWorkflowService) private readonly workflow: PeriodWorkflowService) {}

  /** Khóa kỳ rồi hồ sơ, kiểm phase, trạng thái, tiêu chí và lý do trước khi lưu
   * Giờ và người duyệt lấy từ DB và phiên, điểm tối đa lấy từ tiêu chí cùng kỳ
   * Đồng bộ hết hạn bổ sung trước kiểm quyền, trả lỗi nghiệp vụ sau commit để giữ đồng bộ
   * Lỗi DB hoặc audit làm rollback toàn bộ và được bộ lọc HTTP chuẩn hóa
   */
  async review(id: string, criterionId: string, dto: ReviewScoreDto, user: CurrentUser) {
    if (user.role !== "ADMIN") throw new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ quản trị viên được thẩm định hồ sơ" });
    const result = await this.prisma.$transaction(async (tx) => {
      const ref = await tx.evaluation.findUnique({ where: { id }, select: { periodId: true } });
      if (!ref) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      await lockPeriod(tx, ref.periodId, "shared");
      await tx.$queryRaw`SELECT id FROM evaluations WHERE id = ${id}::uuid FOR UPDATE`;
      const evaluation = await tx.evaluation.findUnique({ where: { id }, include: { period: true } });
      if (!evaluation) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      const now = await this.state.databaseNow(tx);
      const current = await this.state.reconcileSupplement(tx, evaluation, evaluation.period, now);
      if (!["FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW"].includes(evaluation.period.phase) || !["PENDING_REVIEW", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"].includes(current.status)) return { error: new ForbiddenException({ code: "REVIEW_LOCKED", message: "Hồ sơ chưa ở trạng thái được phép thẩm định" }) };
      const score = await tx.criterionScore.findUnique({ where: { evaluationId_criterionId: { evaluationId: id, criterionId } }, include: { criterion: { include: { children: { select: { id: true } } } } } });
      if (!score || score.criterion.periodId !== ref.periodId || score.criterion.children.length) return { error: new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy tiêu chí lá trong hồ sơ" }) };
      const value = new Prisma.Decimal(dto.adminScore);
      if (value.gt(score.criterion.maxScore)) return { error: new UnprocessableEntityException({ code: "BUSINESS_RULE_VIOLATION", message: "Điểm thẩm định không được vượt quá điểm tối đa của tiêu chí" }) };
      const comment = dto.adminComment?.trim() || null;
      if ((!score.selfScore || !value.eq(score.selfScore)) && !comment) return { error: new UnprocessableEntityException({ code: "BUSINESS_RULE_VIOLATION", message: "Cần nhập lý do khi điểm thẩm định khác điểm tự chấm hoặc chưa có điểm tự chấm" }) };
      const after = await tx.criterionScore.update({ where: { id: score.id }, data: { adminScore: value, adminComment: comment, reviewedById: user.id, reviewedAt: now, updatedAt: now } });
      await this.audit.record({ actorId: user.id, action: "REVIEW_SCORE", entity: "CriterionScore", entityId: score.id, before: { adminScore: score.adminScore?.toString() ?? null, adminComment: score.adminComment }, after: { adminScore: after.adminScore?.toString() ?? null, adminComment: after.adminComment } }, tx);
      return { value: { evaluationId: id, criterionId, adminScore: after.adminScore!.toNumber(), adminComment: after.adminComment, reviewedById: after.reviewedById, reviewedAt: after.reviewedAt!.toISOString() } };
    });
    if (result.error instanceof HttpException) throw result.error;
    return result.value;
  }

  /** Chấp nhận từng ô chưa có điểm Admin bằng điểm tự chấm trong một transaction
   * Khóa kỳ trước hồ sơ để tuần tự với lưu điểm, chuyển phase và các lệnh duyệt khác
   * Không ghi đè điểm đã duyệt, bỏ qua điểm tự chấm null và audit mỗi ô thực sự thay đổi
   */
  async acceptAll(id: string, user: CurrentUser) {
    if (user.role !== "ADMIN") throw new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ quản trị viên được thẩm định hồ sơ" });
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.evaluation.findUnique({ where: { id }, select: { periodId: true } });
      if (!ref) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      await lockPeriod(tx, ref.periodId, "shared");
      await tx.$queryRaw`SELECT id FROM evaluations WHERE id = ${id}::uuid FOR UPDATE`;
      const evaluation = await tx.evaluation.findUnique({ where: { id }, include: { period: true } });
      if (!evaluation) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      const now = await this.state.databaseNow(tx);
      const current = await this.state.reconcileSupplement(tx, evaluation, evaluation.period, now);
      if (!["FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW"].includes(evaluation.period.phase) || !["PENDING_REVIEW", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"].includes(current.status)) return { error: new ForbiddenException({ code: "REVIEW_LOCKED", message: "Hồ sơ chưa ở trạng thái được phép thẩm định" }) };
      const scores = await tx.criterionScore.findMany({ where: { evaluationId: id, adminScore: null, selfScore: { not: null }, criterion: { children: { none: {} } } }, orderBy: { id: "asc" } });
      for (const score of scores) {
        await tx.criterionScore.update({ where: { id: score.id }, data: { adminScore: score.selfScore, adminComment: null, reviewedById: user.id, reviewedAt: now, updatedAt: now } });
        await this.audit.record({ actorId: user.id, action: "REVIEW_SCORE", entity: "CriterionScore", entityId: score.id, before: { adminScore: null, adminComment: score.adminComment }, after: { adminScore: score.selfScore?.toString() ?? null, adminComment: null } }, tx);
      }
      return { evaluationId: id, acceptedCount: scores.length };
    }, { timeout: 30_000, maxWait: 10_000 }).then((result) => {
      if ("error" in result) throw result.error;
      return result;
    });
  }

  /** Chốt dấu hoàn tất thẩm định lần đầu mà không chuyển phase hoặc chốt điểm
   * Chỉ hồ sơ chờ duyệt và mọi điểm lá đã có Admin mới được ghi mốc từ đồng hồ DB
   * Lệnh lặp trả snapshot cũ và không ghi audit trùng, mọi bước giữ cùng khóa hồ sơ
   */
  async completeFirstReview(id: string, user: CurrentUser) {
    if (user.role !== "ADMIN") throw new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ quản trị viên được thẩm định hồ sơ" });
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.evaluation.findUnique({ where: { id }, select: { periodId: true } });
      if (!ref) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      await lockPeriod(tx, ref.periodId, "shared");
      await tx.$queryRaw`SELECT id FROM evaluations WHERE id = ${id}::uuid FOR UPDATE`;
      const evaluation = await tx.evaluation.findUnique({ where: { id }, include: { period: true } });
      if (!evaluation) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      if (evaluation.firstReviewedAt) return { evaluationId: id, firstReviewedAt: evaluation.firstReviewedAt.toISOString() };
      if (!["FIRST_REVIEW", "SUPPLEMENT"].includes(evaluation.period.phase) || evaluation.status !== "PENDING_REVIEW") throw new ForbiddenException({ code: "REVIEW_LOCKED", message: "Hồ sơ chưa ở trạng thái được phép hoàn tất thẩm định lần đầu" });
      const scores = await tx.criterionScore.findMany({ where: { evaluationId: id }, select: { adminScore: true } });
      const leafCount = await tx.criterion.count({ where: { periodId: ref.periodId, children: { none: {} } } });
      if (!leafCount || scores.length !== leafCount || scores.some((score) => score.adminScore === null)) throw new UnprocessableEntityException({ code: "BUSINESS_RULE_VIOLATION", message: "Cần thẩm định điểm cho mọi tiêu chí trước khi hoàn tất" });
      const now = await this.state.databaseNow(tx);
      await tx.evaluation.update({ where: { id }, data: { firstReviewedAt: now, updatedAt: now } });
      await this.audit.record({ actorId: user.id, action: "FIRST_REVIEW_COMPLETE", entity: "Evaluation", entityId: id, before: { firstReviewedAt: null }, after: { firstReviewedAt: now.toISOString() } }, tx);
      return { evaluationId: id, firstReviewedAt: now.toISOString() };
    });
  }

  /** Chốt kết quả một hồ sơ trong phase cuối sau khi giữ khóa kỳ và hồ sơ
   * View DB tính tổng Decimal và dùng fn_rating_for_percent với phần trăm chưa làm tròn
   * Không cho chốt lại hoặc chốt khi vòng bổ sung còn mở, trạng thái hết hạn được đồng bộ trước
   * Kết quả, lịch sử, audit và hộp thư cùng transaction, lỗi bất kỳ làm rollback toàn bộ
   */
  async finalize(id: string, user: CurrentUser) {
    if (user.role !== "ADMIN") throw new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ quản trị viên được chốt hồ sơ" });
    const result = await this.prisma.$transaction(async (tx) => {
      const ref = await tx.evaluation.findUnique({ where: { id }, select: { periodId: true } });
      if (!ref) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      await lockPeriod(tx, ref.periodId, "shared");
      await tx.$queryRaw`SELECT id FROM evaluations WHERE id = ${id}::uuid FOR UPDATE`;
      const evaluation = await tx.evaluation.findUnique({ where: { id }, include: { period: true } });
      if (!evaluation) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      const now = await this.state.databaseNow(tx);
      const current = await this.state.reconcileSupplement(tx, evaluation, evaluation.period, now);
      if (evaluation.period.phase !== "FINAL_REVIEW" || !current.firstReviewedAt || !["PENDING_REVIEW", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"].includes(current.status)) return { error: new ForbiddenException({ code: "REVIEW_LOCKED", message: "Hồ sơ chưa đủ điều kiện để chốt kết quả" }) };
      const [totals] = await tx.$queryRaw<{ current_total: Prisma.Decimal; current_percent: Prisma.Decimal; suggested_rating: string | null }[]>`SELECT current_total, current_percent, suggested_rating FROM v_evaluation_totals WHERE evaluation_id = ${id}::uuid`;
      if (!totals?.suggested_rating) return { error: new UnprocessableEntityException({ code: "BUSINESS_RULE_VIOLATION", message: "Kỳ đánh giá chưa có ngưỡng xếp loại phù hợp" }) };
      // Lấy nhãn cùng snapshot chốt để kết quả FE không giữ nhãn từ preview đã cũ
      // Cấu hình ngưỡng đã khóa sau công bố, nhãn này tương ứng chính xác mã xếp loại vừa tính
      const threshold = await tx.ratingThreshold.findFirstOrThrow({ where: { periodId: ref.periodId, rating: totals.suggested_rating }, select: { label: true } });
      const after = await tx.evaluation.update({ where: { id }, data: { status: "FINALIZED", finalScore: totals.current_total, finalPercent: totals.current_percent, finalRating: totals.suggested_rating, finalizedById: user.id, finalizedAt: now, updatedAt: now } });
      await tx.statusHistory.create({ data: { id: randomUUID(), evaluationId: id, actorId: user.id, fromStatus: current.status, toStatus: "FINALIZED", comment: "Đã chốt kết quả thẩm định", createdAt: now } });
      await this.audit.record({ actorId: user.id, action: "FINALIZE", entity: "Evaluation", entityId: id, before: { status: current.status }, after: { status: after.status, finalScore: totals.current_total.toString(), finalPercent: totals.current_percent.toString(), finalRating: totals.suggested_rating } }, tx);
      const recipients = await tx.user.findMany({ where: { role: "UNIT", unitId: current.unitId, isActive: true }, select: { id: true } });
      for (const recipient of recipients) await this.notifications.notifyUser(tx, { userId: recipient.id, type: "EVALUATION_FINALIZED", title: "Đã chốt kết quả đánh giá", body: `Kết quả kỳ ${evaluation.period.name} đã được chốt`, dedupeKey: `EVALUATION_FINALIZED:${id}`, refType: "EVALUATION", refId: id });
      return { value: { evaluationId: id, finalScore: totals.current_total.toNumber(), finalPercent: totals.current_percent.toNumber(), finalRating: totals.suggested_rating, finalRatingLabel: threshold.label, finalizedById: user.id, finalizedAt: now.toISOString() } };
    }, { timeout: 30_000, maxWait: 10_000 });
    if (result.error) throw result.error;
    return result.value;
  }

  /** Tạo một vòng bổ sung với lịch Việt Nam được tính và lưu duy nhất sau khi khóa
   * Danh sách phải gồm các lá của hồ sơ, mỗi lá có ghi chú riêng không trắng
   * Lệnh lặp trả lịch và phản hồi đã lưu, không kéo dài hạn hoặc tạo thông báo trùng
   * Cờ, feedback, lịch sử, audit và hộp thư được ghi cùng giao dịch, không gọi provider
   */
  async requestSupplement(id: string, dto: SupplementRequestDto, user: CurrentUser) {
    if (user.role !== "ADMIN") throw new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ quản trị viên được yêu cầu bổ sung" });
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.evaluation.findUnique({ where: { id }, select: { periodId: true } });
      if (!ref) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      await lockPeriod(tx, ref.periodId);
      await tx.$queryRaw`SELECT id FROM evaluations WHERE id = ${id}::uuid FOR UPDATE`;
      const evaluation = await tx.evaluation.findUnique({ where: { id }, include: { period: true } });
      if (!evaluation) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy hồ sơ" });
      if (evaluation.supplementRequestedAt) {
        // Chỉ retry đúng nội dung mới trả snapshot cũ, payload khác phải báo đã có vòng bổ sung
        // Không dùng khóa thời gian mới hoặc reset baseline để mở vòng thứ hai bằng request lặp
        const existing = await tx.criterionScore.findMany({ where: { evaluationId: id, needsSupplement: true }, orderBy: { criterionId: "asc" } });
        const expected = existing.map((score) => ({ criterionId: score.criterionId, note: score.supplementNote }));
        const requested = [...dto.items].sort((a, b) => a.criterionId.localeCompare(b.criterionId)).map((item) => ({ criterionId: item.criterionId, note: item.note.trim() }));
        if (evaluation.supplementStartAt?.getTime() !== new Date(dto.supplementStartAt).getTime() || evaluation.supplementDeadline?.getTime() !== new Date(dto.supplementDeadline).getTime() || JSON.stringify(expected) !== JSON.stringify(requested)) throw new ConflictException({ code: "SUPPLEMENT_ALREADY_REQUESTED", message: "Hồ sơ đã có một vòng bổ sung, không được tạo vòng mới hoặc thay đổi lịch" });
        const feedback = await tx.evaluationFeedback.findFirst({ where: { evaluationId: id, type: "SUPPLEMENT_REQUEST" }, orderBy: { createdAt: "asc" } });
        return { evaluationId: id, status: evaluation.status, supplementRequestedAt: evaluation.supplementRequestedAt.toISOString(), supplementStartAt: evaluation.supplementStartAt?.toISOString() ?? null, supplementDeadline: evaluation.supplementDeadline?.toISOString() ?? null, feedbackId: feedback?.id ?? null };
      }
      if (!["FIRST_REVIEW", "SUPPLEMENT"].includes(evaluation.period.phase) || evaluation.status !== "PENDING_REVIEW" || !evaluation.firstReviewedAt) throw new ForbiddenException({ code: "REVIEW_LOCKED", message: "Hồ sơ chưa đủ điều kiện yêu cầu bổ sung" });
      const now = await this.state.databaseNow(tx);
      const start = new Date(dto.supplementStartAt);
      const deadline = this.deadlines.supplementDeadline(start, new Date(dto.supplementDeadline));
      if (start < now) throw new UnprocessableEntityException({ code: "BUSINESS_RULE_VIOLATION", message: "Thời gian mở bổ sung không được trước thời điểm yêu cầu" });
      const scores = await tx.criterionScore.findMany({ where: { evaluationId: id, criterionId: { in: dto.items.map((item) => item.criterionId) }, criterion: { children: { none: {} }, periodId: ref.periodId } }, include: { evidences: true } });
      if (scores.length !== dto.items.length || dto.items.some((item) => !item.note.trim())) throw new UnprocessableEntityException({ code: "BUSINESS_RULE_VIOLATION", message: "Mỗi tiêu chí lá được chọn phải thuộc hồ sơ và có yêu cầu bổ sung" });
      for (const item of dto.items) {
        const score = scores.find((row) => row.criterionId === item.criterionId)!;
        await tx.criterionScore.update({ where: { id: score.id }, data: { needsSupplement: true, supplementNote: item.note.trim(), supplementedAt: null, supplementBaseline: captureSupplementBaseline(score, now), updatedAt: now } });
      }
      const feedback = await tx.evaluationFeedback.create({ data: { id: randomUUID(), evaluationId: id, authorId: user.id, type: "SUPPLEMENT_REQUEST", content: dto.items.map((item) => item.note.trim()).join("\n"), createdAt: now } });
      await tx.evaluation.update({ where: { id }, data: { status: "SUPPLEMENT_REQUESTED", supplementRequestedAt: now, supplementStartAt: start, supplementDeadline: deadline, updatedAt: now } });
      if (evaluation.period.phase === "FIRST_REVIEW") await this.workflow.transitionInTransaction(tx, ref.periodId, "SUPPLEMENT", user.id);
      await tx.statusHistory.create({ data: { id: randomUUID(), evaluationId: id, actorId: user.id, fromStatus: evaluation.status, toStatus: "SUPPLEMENT_REQUESTED", comment: "Yêu cầu đơn vị bổ sung minh chứng", createdAt: now } });
      await this.audit.record({ actorId: user.id, action: "SUPPLEMENT_REQUEST", entity: "Evaluation", entityId: id, before: { status: evaluation.status }, after: { status: "SUPPLEMENT_REQUESTED", supplementStartAt: start.toISOString(), supplementDeadline: deadline.toISOString(), items: dto.items.map((item) => ({ criterionId: item.criterionId, note: item.note.trim() })) } }, tx);
      const recipients = await tx.user.findMany({ where: { role: "UNIT", unitId: evaluation.unitId, isActive: true }, select: { id: true } });
      const format = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
      for (const recipient of recipients) await this.notifications.notifyUser(tx, { userId: recipient.id, type: "SUPPLEMENT_REQUESTED", title: "Yêu cầu bổ sung hồ sơ", body: `Kỳ ${evaluation.period.name} mở bổ sung từ ${format.format(start)} đến trước ${format.format(deadline)} theo giờ Việt Nam`, dedupeKey: `SUPPLEMENT_REQUESTED:${id}`, refType: "EVALUATION", refId: id });
      return { evaluationId: id, status: "SUPPLEMENT_REQUESTED", supplementRequestedAt: now.toISOString(), supplementStartAt: start.toISOString(), supplementDeadline: deadline.toISOString(), feedbackId: feedback.id };
    }, { timeout: 30_000, maxWait: 10_000 });
  }

  /** Gọi use-case thẩm định đơn tuần tự để từng ô có transaction và audit riêng
   * Chuẩn hóa mọi lỗi qua filter dùng chung, không trả ngoại lệ hay SQL thô
   */
  async batchReview(id: string, dto: BatchReviewDto, user: CurrentUser) {
    if (user.role !== "ADMIN") throw new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ quản trị viên được thẩm định hồ sơ" });
    const filter = new AllExceptionsFilter();
    const results = [];
    for (const item of dto.items) {
      try { results.push({ criterionId: item.criterionId, ok: true, data: await this.review(id, item.criterionId, item, user) }); }
      catch (error) { results.push({ criterionId: item.criterionId, ok: false, error: filter.toApiError(error) }); }
    }
    return { results };
  }

  /** Chốt từng hồ sơ tuần tự bằng use-case đơn, giữ kết quả độc lập và đúng thứ tự
   * Các lỗi được chuẩn hóa sau rollback của từng transaction, không lộ SQL hoặc provider
   */
  async batchFinalize(dto: BatchFinalizeDto, user: CurrentUser) {
    if (user.role !== "ADMIN") throw new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ quản trị viên được chốt hồ sơ" });
    const filter = new AllExceptionsFilter();
    const results = [];
    for (const evaluationId of dto.evaluationIds) {
      try { results.push({ evaluationId, ok: true, data: await this.finalize(evaluationId, user) }); }
      catch (error) { results.push({ evaluationId, ok: false, error: filter.toApiError(error) }); }
    }
    return { results };
  }

  /** Xem trước điểm hiệu lực và khả năng chốt cho từng hồ sơ trong snapshot DB
   * View dùng cùng công thức với lệnh chốt, không ghi trạng thái hay coi preview là quyền
   * Hết hạn bổ sung được nhận diện bằng giờ DB, lệnh chốt sẽ đồng bộ và kiểm lại sau khóa
   */
  async previewFinalize(dto: BatchFinalizeDto, user: CurrentUser) {
    if (user.role !== "ADMIN") throw new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ quản trị viên được xem kết quả thẩm định" });
    const results = [];
    for (const evaluationId of dto.evaluationIds) {
      const entry = await this.prisma.$transaction(async (tx) => {
        const evaluation = await tx.evaluation.findUnique({ where: { id: evaluationId }, include: { period: { include: { ratingThresholds: true } }, unit: { select: { name: true } } } });
        if (!evaluation) return { evaluationId, ok: false, error: { statusCode: 404, code: "NOT_FOUND", message: "Không tìm thấy hồ sơ", details: [] } };
        const now = await this.state.databaseNow(tx);
        const expired = evaluation.status === "SUPPLEMENT_REQUESTED" && evaluation.supplementDeadline !== null && now >= evaluation.supplementDeadline;
        const eligibleStatus = ["PENDING_REVIEW", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED"].includes(evaluation.status) || expired;
        const [totals] = await tx.$queryRaw<{ current_total: Prisma.Decimal; current_percent: Prisma.Decimal; suggested_rating: string | null }[]>`SELECT current_total, current_percent, suggested_rating FROM v_evaluation_totals WHERE evaluation_id = ${evaluationId}::uuid`;
        const canFinalize = evaluation.period.phase === "FINAL_REVIEW" && Boolean(evaluation.firstReviewedAt) && eligibleStatus && Boolean(totals?.suggested_rating);
        return { evaluationId, ok: true, data: { unitName: evaluation.unit.name, periodName: evaluation.period.name, score: totals?.current_total.toNumber() ?? null, percent: totals?.current_percent.toNumber() ?? null, rating: totals?.suggested_rating ?? null, ratingLabel: evaluation.period.ratingThresholds.find((item) => item.rating === totals?.suggested_rating)?.label ?? null, canFinalize, message: canFinalize ? "Hồ sơ đủ điều kiện chốt tại thời điểm xem" : "Hồ sơ chưa đủ điều kiện chốt", serverTime: now.toISOString() } };
      }, { isolationLevel: "RepeatableRead" });
      results.push(entry);
    }
    return { results };
  }
}
