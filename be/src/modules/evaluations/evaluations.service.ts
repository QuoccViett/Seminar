import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isDeadlineReminderDue } from "../../common/services/deadline-calculator.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter.js";
import { AuditService } from "../../common/services/audit.service.js";
import { lockPeriod } from "../../common/services/period-lock.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { BatchSelfScoreDto, CreateEvaluationDto, EvaluationQueryDto, SelfScoreDto } from "./dto/evaluation.dto.js";
import { EvaluationStateService } from "./evaluation-state.service.js";
import { selfLockedReason, selfSummary } from "./evaluation-policy.js";
import { reviewPermissions, supplementChanged } from "./review-policy.js";

const contextInclude = {
  unit: true,
  period: { include: { criteria: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }, ratingThresholds: true } },
  criterionScores: { include: { evidences: true, reviewedBy: { select: { fullName: true } } } },
} satisfies Prisma.EvaluationInclude;
type Context = Prisma.EvaluationGetPayload<{ include: typeof contextInclude }>;

/** Quản lý hồ sơ và điểm tự chấm, chỉ nhận danh tính đã được Auth kiểm tra
 * Mọi đường ghi khóa kỳ rồi hồ sơ, không dựa vào quyền FE hoặc status do client gửi
 * Projection tự chấm tách hẳn điểm Admin và view tổng phục vụ dashboard
 */
@Injectable()
export class EvaluationsService {
  /** Tiêm rõ các dependency dùng chung để giữ cấu trúc Auth và hỗ trợ ESM/tsx
   * state thực hiện reconcile nguyên tử, audit ghi snapshot cùng transaction nghiệp vụ
   */
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EvaluationStateService) private readonly state: EvaluationStateService,
  ) {}

  /** Tạo điều kiện sở hữu ngay trong truy vấn để UNIT không dò được hồ sơ khác
   * ADMIN có thể đọc mọi hồ sơ, UNIT thiếu đơn vị luôn không khớp bản ghi nào
   * Kỳ nháp bị ẩn ở cả list/detail/summary và các đường ghi cho UNIT
   */
  private scope(user: CurrentUser): Prisma.EvaluationWhereInput {
    return user.role === "ADMIN" ? {} : { unitId: user.unitId ?? "00000000-0000-4000-8000-000000000000", period: { publishedAt: { not: null } } };
  }

  /** Đọc và reconcile hồ sơ trong một transaction giữ khóa theo thứ tự chung
   * callback trả HttpException cho lỗi nghiệp vụ đã dự kiến để reconcile vẫn commit
   * Lỗi DB/audit không được bắt tại đây, toàn transaction phải rollback trước khi báo lỗi
   * Trả lỗi ra HTTP sau commit giúp request quá hạn khóa hồ sơ dù lệnh lưu bị từ chối
   */
  private async run<T>(id: string, user: CurrentUser, work: (tx: Prisma.TransactionClient, context: Context, now: Date) => Promise<T | HttpException>): Promise<T> {
    const result = await this.prisma.$transaction(async (tx) => {
      const ref = await tx.evaluation.findFirst({ where: { id, ...this.scope(user) }, select: { periodId: true } });
      if (!ref) throw this.notFound();
      await lockPeriod(tx, ref.periodId);
      await tx.$queryRaw`SELECT id FROM evaluations WHERE id = ${id}::uuid FOR UPDATE`;
      const context = await tx.evaluation.findFirst({ where: { id, ...this.scope(user) }, include: contextInclude });
      if (!context) throw this.notFound();
      const now = await this.state.databaseNow(tx);
      Object.assign(context, await this.state.reconcileInitial(tx, context, context.period, now));
      Object.assign(context, await this.state.reconcileSupplement(tx, context, context.period, now));
      const value = await work(tx, context, now);
      // Nếu kiểm nghiệp vụ vừa vượt deadline, vẫn commit auto-lock trước khi trả lỗi dự kiến
      // Không bắt lỗi SQL ở đây vì transaction lỗi phải rollback toàn bộ và được filter chuẩn hóa
      if (value instanceof HttpException) {
        const rejectedAt = await this.state.databaseNow(tx);
        Object.assign(context, await this.state.reconcileInitial(tx, context, context.period, rejectedAt));
        await this.state.reconcileSupplement(tx, context, context.period, rejectedAt);
      }
      return value instanceof HttpException ? { error: value } : { value };
    }, { timeout: 30_000, maxWait: 10_000 });
    if (result.error) throw result.error;
    return result.value as T;
  }

  /** Reconcile trước lọc status và phân trang để hồ sơ quá hạn không còn nằm nhầm nhóm đang mở
   * Mỗi hồ sơ một transaction lấy khóa chung, thứ tự UUID cố định tránh khóa nhiều kỳ chéo nhau
   * Lấy DRAFT hoặc SUPPLEMENT_REQUESTED đã quá hạn theo giờ DB, run kiểm lại sau khóa chống tranh với submit
   */
  private async reconcileScope(user: CurrentUser, periodId?: string): Promise<void> {
    const now = await this.state.databaseNow(this.prisma);
    const rows = await this.prisma.evaluation.findMany({ where: {
      AND: [this.scope(user), { ...(periodId ? { periodId } : {}), OR: [{ status: "DRAFT", period: { publishedAt: { not: null }, selfEvalDeadline: { lte: now } } }, { status: "SUPPLEMENT_REQUESTED", supplementDeadline: { lte: now } }] }],
    }, select: { id: true }, orderBy: { id: "asc" } });
    for (const row of rows) await this.run(row.id, user, async () => null);
  }

  /** Liệt kê metadata có phân trang sau reconcile, không tải cây hoặc điểm qua đường danh sách
   * query nhận kỳ/trạng thái, phạm vi đơn vị luôn từ phiên; total và items cùng snapshot DB
   * Metadata cho phép UNIT xem lịch trước mở mà không nhận tiêu chí hoặc minh chứng
   */
  async list(query: EvaluationQueryDto, user: CurrentUser) {
    await this.reconcileScope(user, query.periodId);
    const where: Prisma.EvaluationWhereInput = { AND: [this.scope(user), { ...(query.periodId ? { periodId: query.periodId } : {}), ...(query.status ? { status: query.status } : {}) }] };
    return this.prisma.$transaction(async (tx) => {
      const now = await this.state.databaseNow(tx);
      // Một interactive transaction dùng một connection, đọc tuần tự tránh hai query chồng trên pg
      const items = await tx.evaluation.findMany({ where, include: { period: true, unit: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
      const total = await tx.evaluation.count({ where });
      return { items: items.map((item) => this.metadata(item, now, user)), total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: "RepeatableRead" });
  }

  /** Tạo bù idempotent cho đơn vị mới trong kỳ công bố chưa kết thúc tự chấm
   * Khóa kỳ tuần tự với publish và tạo bù khác, score null chỉ được sinh cho lá
   * UNIT không tự truyền unitId, ADMIN phải chỉ đơn vị hoạt động; không tạo hồ sơ cho kỳ nháp
   * Lệnh lặp đọc lại metadata, không ghi thêm audit hoặc reset điểm đang có
   */
  async create(dto: CreateEvaluationDto, user: CurrentUser) {
    if (user.role === "UNIT" && dto.unitId !== undefined) throw new ForbiddenException({ code: "FORBIDDEN", message: "Đơn vị không được chỉ định hồ sơ của đơn vị khác" });
    const unitId = user.role === "UNIT" ? user.unitId : dto.unitId;
    if (!unitId) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "Cần xác định đơn vị để tạo hồ sơ" });
    const id = await this.prisma.$transaction(async (tx) => {
      await lockPeriod(tx, dto.periodId);
      const period = await tx.evaluationPeriod.findUnique({ where: { id: dto.periodId }, include: { criteria: true } });
      if (!period?.publishedAt) throw this.notFound();
      const existing = await tx.evaluation.findUnique({ where: { periodId_unitId: { periodId: dto.periodId, unitId } } });
      if (existing) return existing.id;
      const now = await this.state.databaseNow(tx);
      if (!["SETUP", "SELF_EVAL"].includes(period.phase) || !period.selfEvalDeadline || now >= period.selfEvalDeadline) throw this.locked("Không thể tạo hồ sơ mới khi thời gian tự chấm đã kết thúc");
      const unit = await tx.unit.findFirst({ where: { id: unitId, isActive: true } });
      if (!unit) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy đơn vị đang hoạt động" });
      const evaluation = await tx.evaluation.create({ data: { id: randomUUID(), periodId: dto.periodId, unitId, status: "DRAFT", createdAt: now, updatedAt: now } });
      const parents = new Set(period.criteria.map((criterion) => criterion.parentId));
      const leaves = period.criteria.filter((criterion) => !parents.has(criterion.id));
      await tx.criterionScore.createMany({ data: leaves.map((leaf) => ({ id: randomUUID(), evaluationId: evaluation.id, criterionId: leaf.id, createdAt: now, updatedAt: now })) });
      await this.audit.record({ actorId: user.id, action: "CREATE", entity: "Evaluation", entityId: evaluation.id, after: { periodId: dto.periodId, unitId, status: "DRAFT" } }, tx);
      return evaluation.id;
    });
    return this.run(id, user, async (_tx, context, now) => this.metadata(context, now, user));
  }

  /** Đọc cây theo quyền, dùng projection riêng trước mở để không lộ nội dung qua quan hệ lồng nhau
   * Sau mở, mỗi lá nhận quyền và giờ server cùng dữ liệu tự chấm an toàn
   * Không trả storagePath hoặc thông tin người thẩm định cho UNIT trước chốt
   */
  detail(id: string, user: CurrentUser) {
    return this.run(id, user, async (_tx, context, now) => {
      const metadata = this.metadata(context, now, user);
      if (!metadata.criteriaVisible) return { ...metadata, criteria: [] };
      const scores = new Map(context.criterionScores.map((score) => [score.criterionId, score]));
      /** Dựng cây từ quan hệ parentId đã được VC08 kiểm chu kỳ và giới hạn độ sâu
       * Nhóm không có điểm/quyền sửa, lá thiếu score vẫn hiển thị null và bị chặn ở đường ghi
       */
      const tree = (parentId: string | null): object[] => context.period.criteria.filter((criterion) => criterion.parentId === parentId).map((criterion) => {
        const children = tree(criterion.id);
        const score = scores.get(criterion.id);
        const reason = children.length ? "Chỉ được chấm điểm tiêu chí lá" : user.role === "ADMIN" ? "Chỉ đơn vị được tự chấm hồ sơ" : selfLockedReason(context.period, context, now, score?.needsSupplement);
        return {
          criterionId: criterion.id, code: criterion.code, name: criterion.name, description: criterion.description,
          maxScore: criterion.maxScore.toNumber(), evidenceRequirement: criterion.evidenceRequirement,
          evidenceRequired: criterion.evidenceRequired, allowText: criterion.allowText, allowFile: criterion.allowFile, allowLink: criterion.allowLink,
          children, canEditSelf: reason === null, lockedReason: reason, serverTime: now.toISOString(),
          ...(!children.length ? {
            selfScore: score?.selfScore?.toNumber() ?? null, selfNote: score?.selfNote ?? null,
            needsSupplement: score?.needsSupplement ?? false,
            ...((user.role === "ADMIN" || context.status === "SUPPLEMENT_REQUESTED") && score?.needsSupplement ? { supplementNote: score.supplementNote } : {}),
            ...(user.role === "ADMIN" ? { adminScore: score?.adminScore?.toNumber() ?? null, adminComment: score?.adminComment ?? null, reviewedById: score?.reviewedById ?? null, reviewedByName: score?.reviewedBy?.fullName ?? null, reviewedAt: score?.reviewedAt?.toISOString() ?? null, supplementedAt: score?.supplementedAt?.toISOString() ?? null, supplementBaseline: score?.supplementBaseline ?? null, supplementChanged: score ? supplementChanged(score) : false } : {}),
            // Quyền xóa lấy từ snapshot server, INITIAL được giữ bất biến khi đang bổ sung
            // Không đưa key hoặc URL ký vào polling detail, chỉ cấp URL sau thao tác đọc có Auth
            evidences: (score?.evidences ?? []).map((evidence) => ({ id: evidence.id, kind: evidence.kind, round: evidence.round, fileName: evidence.fileName, mimeType: evidence.mimeType, sizeBytes: evidence.sizeBytes?.toString() ?? null, externalUrl: evidence.externalUrl, description: evidence.description, previewStatus: evidence.previewStatus, createdAt: evidence.createdAt.toISOString(), canDelete: reason === null && (context.status === "DRAFT" || evidence.round === "SUPPLEMENT") })),
          } : {}),
        };
      });
      return { ...metadata, criteria: tree(null) };
    });
  }

  /** Tính summary chỉ từ điểm tự chấm, ẩn hẳn trước mở với UNIT
   * Lá và ngưỡng cùng snapshot khóa, kết quả cuối chỉ thêm khi trạng thái đã FINALIZED
   */
  summary(id: string, user: CurrentUser) {
    return this.run(id, user, async (_tx, context, now) => {
      if (!this.metadata(context, now, user).criteriaVisible) return new ForbiddenException({ code: "NOT_OPEN_YET", message: "Chưa đến giờ mở tiêu chí và tổng điểm tự chấm" });
      const parents = new Set(context.period.criteria.map((criterion) => criterion.parentId));
      return { ...selfSummary(id, context.period.maxTotalScore, context.period.criteria.filter((criterion) => !parents.has(criterion.id)), context.criterionScores, context.period.ratingThresholds),
        isFinal: context.status === "FINALIZED", ...(context.status === "FINALIZED" ? { finalResult: this.finalResult(context) } : {}),
      };
    });
  }

  /** Lưu một lá sau kiểm sở hữu, lịch, trạng thái, khoảng điểm và loại diễn giải
   * Không spread DTO vào Prisma, trường bỏ qua giữ nguyên còn null chủ động xóa
   * Recheck giờ DB ngay sát UPDATE, trigger kiểm thêm tại statement ghi để chặn vượt biên
   * Chỉ audit khi dữ liệu thật sự đổi, thao tác lưu lặp không gây lịch sử giả
   */
  save(id: string, criterionId: string, dto: SelfScoreDto, user: CurrentUser) {
    return this.run(id, user, async (tx, context) => {
      if (user.role !== "UNIT") return new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ đơn vị được lưu điểm tự chấm" });
      const now = await this.state.databaseNow(tx);
      const criterion = context.period.criteria.find((item) => item.id === criterionId);
      const score = context.criterionScores.find((item) => item.criterionId === criterionId);
      // Kiểm deadline bằng giờ DB ngay cả khi scheduler chưa chuyển trạng thái hết hạn
      // Hồ sơ đã nộp sớm giữ lỗi khóa thông thường, không biến thành lỗi quá hạn giả
      if (context.status === "SUPPLEMENT_EXPIRED" || context.status === "SUPPLEMENT_REQUESTED" && context.supplementDeadline && now >= context.supplementDeadline) return new ForbiddenException({ code: "DEADLINE_PASSED", message: "Đã hết thời gian bổ sung hồ sơ" });
      const reason = selfLockedReason(context.period, context, now, score?.needsSupplement);
      if (reason) return this.locked(reason);
      if (!criterion) return this.notFound("Không tìm thấy tiêu chí trong hồ sơ");
      if (context.period.criteria.some((item) => item.parentId === criterionId)) return this.rule("Chỉ được tự chấm tiêu chí lá");
      if (!score) return this.rule("Hồ sơ chưa được khởi tạo điểm cho tiêu chí này");
      if (dto.selfScore === undefined && dto.selfNote === undefined) return new BadRequestException({ code: "VALIDATION_ERROR", message: "Cần gửi điểm tự chấm hoặc diễn giải để lưu" });
      if (dto.selfScore !== undefined && dto.selfScore !== null && new Prisma.Decimal(dto.selfScore).gt(criterion.maxScore)) return this.rule("Điểm tự chấm không được vượt quá điểm tối đa của tiêu chí", "selfScore");
      if (!criterion.allowText && dto.selfNote?.trim()) return this.rule("Tiêu chí này không cho phép minh chứng bằng diễn giải", "selfNote");
      const selfScore = dto.selfScore === undefined ? score.selfScore : dto.selfScore === null ? null : new Prisma.Decimal(dto.selfScore);
      const selfNote = dto.selfNote === undefined ? score.selfNote : dto.selfNote;
      const changed = (selfScore?.toString() ?? null) !== (score.selfScore?.toString() ?? null) || selfNote !== score.selfNote;
      if (!changed) return { evaluationId: id, criterionId, selfScore: score.selfScore?.toNumber() ?? null, selfNote: score.selfNote, updatedAt: score.updatedAt.toISOString() };
      const writeTime = await this.state.databaseNow(tx);
      if (context.status === "SUPPLEMENT_REQUESTED" && context.supplementDeadline && writeTime >= context.supplementDeadline) return new ForbiddenException({ code: "DEADLINE_PASSED", message: "Đã hết thời gian bổ sung hồ sơ" });
      const writeReason = selfLockedReason(context.period, context, writeTime, score.needsSupplement);
      if (writeReason) return this.locked(writeReason);
      // Nội dung bổ sung thay đổi làm điểm duyệt cũ không còn phản ánh bằng chứng mới
      // Giữ lịch sử qua audit và buộc Admin thẩm định lại, kể cả chỉ sửa diễn giải
      const invalidateReview = context.status === "SUPPLEMENT_REQUESTED";
      const after = await tx.criterionScore.update({ where: { id: score.id }, data: { selfScore, selfNote, updatedAt: writeTime, ...(invalidateReview ? { adminScore: null, adminComment: null, reviewedById: null, reviewedAt: null } : {}) } });
      await this.audit.record({ actorId: user.id, action: "SELF_SCORE", entity: "CriterionScore", entityId: score.id,
        before: { selfScore: score.selfScore?.toNumber() ?? null, selfNote: score.selfNote, adminScore: score.adminScore?.toNumber() ?? null, adminComment: score.adminComment },
        after: { selfScore: after.selfScore?.toNumber() ?? null, selfNote: after.selfNote, adminScore: after.adminScore?.toNumber() ?? null, adminComment: after.adminComment },
      }, tx);
      return { evaluationId: id, criterionId, selfScore: after.selfScore?.toNumber() ?? null, selfNote: after.selfNote, updatedAt: after.updatedAt.toISOString() };
    });
  }

  /** Lưu tuần tự từng ô bằng transaction độc lập, giữ kết quả theo thứ tự request
   * Lỗi trigger/DB một ô đã rollback trước khi chuyển ô sau, không catch trong transaction abort
   * Bộ chuẩn hóa dùng chung filter HTTP để tuyệt đối không trả exception/provider/SQL thô
   */
  async saveBatch(id: string, dto: BatchSelfScoreDto, user: CurrentUser) {
    await this.run(id, user, async () => null);
    const filter = new AllExceptionsFilter();
    const results = [];
    for (const item of dto.items) {
      try { results.push({ criterionId: item.criterionId, ok: true, data: await this.save(id, item.criterionId, item, user) }); }
      catch (error) { results.push({ criterionId: item.criterionId, ok: false, error: filter.toApiError(error) }); }
    }
    return { results };
  }

  /** Nộp INITIAL sớm sau khi mọi lá có điểm và đủ ít nhất một minh chứng được cấu hình
   * Điểm 0 hợp lệ, diễn giải trắng không thay thế minh chứng, FILE/LINK phải đúng loại được phép
   * Lặp nộp chủ động trả metadata đã khóa, auto-lock không bị biến thành nộp chủ động
   * Giờ DB kiểm lại trước đổi trạng thái, audit/history/outbox commit cùng submittedAt
   */
  submit(id: string, user: CurrentUser) {
    return this.run(id, user, async (tx, context, now) => {
      if (user.role !== "UNIT") return new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ đơn vị được nộp hồ sơ tự chấm" });
      if (context.status === "PENDING_REVIEW" && context.submittedAt) return this.metadata(context, now, user);
      if (context.status !== "DRAFT") return this.locked("Hồ sơ không còn được nộp tự chấm");
      const reason = selfLockedReason(context.period, context, now);
      if (reason) return this.locked(reason);
      const parents = new Set(context.period.criteria.map((criterion) => criterion.parentId));
      const leaves = context.period.criteria.filter((criterion) => !parents.has(criterion.id));
      const details = leaves.flatMap((leaf) => {
        const score = context.criterionScores.find((item) => item.criterionId === leaf.id);
        const messages: string[] = [];
        if (!score || score.selfScore === null) messages.push("Cần nhập điểm tự chấm cho tiêu chí này");
        const hasEvidence = Boolean(leaf.allowText && score?.selfNote?.trim()) || score?.evidences.some((item) => item.kind === "FILE" && leaf.allowFile && Boolean(item.storagePath) || item.kind === "LINK" && leaf.allowLink && Boolean(item.externalUrl));
        if (leaf.evidenceRequired && !hasEvidence) messages.push("Cần có ít nhất một minh chứng thuộc loại được phép cho tiêu chí này");
        return messages.length ? [{ field: leaf.id, messages }] : [];
      });
      if (!leaves.length || details.length) return new UnprocessableEntityException({ code: "INCOMPLETE_EVALUATION", message: "Hồ sơ chưa đủ điểm hoặc minh chứng để nộp", details });
      const writeTime = await this.state.databaseNow(tx);
      const writeReason = selfLockedReason(context.period, context, writeTime);
      if (writeReason) return this.locked(writeReason);
      Object.assign(context, await this.state.pendingReview(tx, context, writeTime, user.id, false));
      return this.metadata(context, writeTime, user);
    });
  }

  /** Nộp một vòng bổ sung trong cửa sổ snapshot sau khi từng lá thực sự thay đổi
   * supplementedAt do trigger cấp khi sửa nội dung hoặc minh chứng, không lấy updatedAt đặt cờ
   * Quá hạn đồng bộ trạng thái trong transaction rồi trả DEADLINE_PASSED sau commit
   * Lệnh lặp sau khi nộp trả metadata đã lưu mà không tạo history hoặc thông báo trùng
   */
  submitSupplement(id: string, user: CurrentUser) {
    return this.run(id, user, async (tx, context, now) => {
      if (user.role !== "UNIT") return new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ đơn vị được nộp nội dung bổ sung" });
      if (context.status === "SUPPLEMENT_SUBMITTED") return this.metadata(context, now, user);
      if (context.status === "SUPPLEMENT_EXPIRED" || context.status === "SUPPLEMENT_REQUESTED" && context.supplementDeadline && now >= context.supplementDeadline) {
        Object.assign(context, await this.state.reconcileSupplement(tx, context, context.period, now));
        return new ForbiddenException({ code: "DEADLINE_PASSED", message: "Đã hết thời gian nộp nội dung bổ sung" });
      }
      const reason = selfLockedReason(context.period, context, now, true);
      if (context.status !== "SUPPLEMENT_REQUESTED" || reason) return this.locked(reason ?? "Hồ sơ không còn được nộp bổ sung");
      const requested = context.criterionScores.filter((score) => score.needsSupplement);
      if (!requested.length || requested.some((score) => !supplementChanged(score))) return new UnprocessableEntityException({ code: "INCOMPLETE_SUPPLEMENT", message: "Cần bổ sung nội dung thực tế cho từng tiêu chí được yêu cầu" });
      const writeTime = await this.state.databaseNow(tx);
      if (!context.supplementDeadline || writeTime >= context.supplementDeadline) {
        Object.assign(context, await this.state.reconcileSupplement(tx, context, context.period, writeTime));
        return new ForbiddenException({ code: "DEADLINE_PASSED", message: "Đã hết thời gian nộp nội dung bổ sung" });
      }
      Object.assign(context, await this.state.submitSupplement(tx, context, writeTime, user.id));
      return this.metadata(context, writeTime, user);
    });
  }

  /** Chiếu metadata công khai và các quyền trình bày từ cùng snapshot giờ server
   * Không spread model DB, không trả finalResult trước chốt hoặc tiêu chí trước mở
   * Cảnh báo dùng cùng ngưỡng động với scheduler, dựa trên giờ server
   */
  private metadata(context: Prisma.EvaluationGetPayload<{ include: { period: true; unit: true } }>, now: Date, user: CurrentUser) {
    const reason = user.role === "ADMIN" ? "Chỉ đơn vị được tự chấm hồ sơ" : selfLockedReason(context.period, context, now, true);
    const deadline = context.status === "SUPPLEMENT_REQUESTED" ? context.supplementDeadline : context.period.selfEvalDeadline;
    const start = context.status === "SUPPLEMENT_REQUESTED" ? context.supplementStartAt : context.period.selfEvalStart;
    return {
      id: context.id, periodId: context.periodId,
      period: { id: context.periodId, name: context.period.name, phase: context.period.phase, selfEvalStart: context.period.selfEvalStart?.toISOString() ?? null, selfEvalDeadline: context.period.selfEvalDeadline?.toISOString() ?? null },
      unit: { id: context.unitId, code: context.unit.code, name: context.unit.name }, status: context.status,
      submittedAt: context.submittedAt?.toISOString() ?? null, autoLockedAt: context.autoLockedAt?.toISOString() ?? null,
      supplementStartAt: context.supplementStartAt?.toISOString() ?? null, supplementDeadline: context.supplementDeadline?.toISOString() ?? null,
      supplementRequestedAt: context.supplementRequestedAt?.toISOString() ?? null, supplementSubmittedAt: context.supplementSubmittedAt?.toISOString() ?? null,
      serverTime: now.toISOString(), criteriaVisible: user.role === "ADMIN" || Boolean(context.period.publishedAt && context.period.selfEvalStart && now >= context.period.selfEvalStart),
      canSubmit: user.role === "UNIT" && context.status === "DRAFT" && reason === null, lockedReason: reason,
      canSubmitSupplement: user.role === "UNIT" && context.status === "SUPPLEMENT_REQUESTED" && reason === null,
      ...(user.role === "ADMIN" ? { firstReviewedAt: context.firstReviewedAt?.toISOString() ?? null, permissions: reviewPermissions(context.period, context, now) } : {}),
      deadlineWarning: reason === null && isDeadlineReminderDue(start, deadline, now) ? "Sắp hết thời gian chỉnh sửa, vui lòng lưu và nộp hồ sơ" : null,
      ...(context.status === "FINALIZED" ? { finalResult: this.finalResult(context) } : {}),
    };
  }

  /** Chỉ lấy snapshot kết quả chốt, điểm 0 giữ nguyên còn dữ liệu chưa có biểu diễn null */
  private finalResult(context: Pick<Context, "finalScore" | "finalPercent" | "finalRating">) {
    return { score: context.finalScore?.toNumber() ?? null, percent: context.finalPercent?.toNumber() ?? null, rating: context.finalRating };
  }

  /** Tạo lỗi ngoài phạm vi dùng chung, không tiết lộ mã hồ sơ hoặc nội dung DB */
  private notFound(message = "Không tìm thấy hồ sơ") { return new NotFoundException({ code: "NOT_FOUND", message }); }

  /** Tạo lỗi quyền theo lịch/trạng thái để FE giữ nội dung chưa lưu và tải lại quyền */
  private locked(message: string) { return new ForbiddenException({ code: "SELF_EVALUATION_LOCKED", message }); }

  /** Tạo lỗi quy tắc có field ổn định khi biết ô cần sửa, không phản chiếu giá trị đầu vào */
  private rule(message: string, field?: string) { return new UnprocessableEntityException({ code: "BUSINESS_RULE_VIOLATION", message, details: field ? [{ field, messages: [message] }] : [] }); }
}
