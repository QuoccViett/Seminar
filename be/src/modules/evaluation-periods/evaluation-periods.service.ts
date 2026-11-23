import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateEvaluationPeriodDto } from "./dto/create-evaluation-period.dto.js";
import type { UpdateEvaluationPeriodDto } from "./dto/update-evaluation-period.dto.js";
import type { UpsertRatingThresholdDto } from "./dto/upsert-rating-threshold.dto.js";
import { ERROR_CODES } from "../../common/constants/error-codes.js";
import type { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { AuditService } from "../../common/services/audit.service.js";
import { ClockService } from "../../common/services/clock.service.js";
import { assertRatingThresholds } from "./rating-threshold-policy.js";
import { lockPeriod } from "../../common/services/period-lock.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { buildPaginationOptions, createPaginatedResult } from "../../common/utils/pagination.util.js";

@Injectable()
export class EvaluationPeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Lấy trang kỳ đánh giá cùng tổng số bản ghi và áp dụng quyền xem tiêu chí theo giờ máy chủ
   * query xác định phân trang còn currentUser phân biệt Admin với đơn vị đang đăng nhập
   * UNIT chỉ được liệt kê kỳ đã công bố và nhận tiêu chí/ngưỡng sau selfEvalStart
   * Kết quả là shape phân trang hiện có với nội dung cấu hình được làm rỗng trước thời điểm mở
   */
  async findAll(query: PaginationQueryDto, currentUser: CurrentUser) {
    const { skip, take, orderBy } = buildPaginationOptions(query, ["createdAt", "year", "name", "phase"]);
    // Lọc ngay trong cả hai truy vấn để tổng số trang không tiết lộ kỳ nháp cho UNIT
    const where = currentUser.role === "ADMIN" ? {} : { publishedAt: { not: null } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.evaluationPeriod.findMany({ where, include: { ratingThresholds: true }, orderBy, skip, take }),
      this.prisma.evaluationPeriod.count({ where }),
    ]);
    return createPaginatedResult(
      items.map((period) => this.maskPeriodConfiguration(period, currentUser)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /** Tải chi tiết kỳ và chỉ trả cấu hình chấm điểm khi vai trò/thời điểm cho phép
   * id được kiểm tra ở controller, còn currentUser đến từ access token đã xác thực
   * UNIT không đọc được kỳ nháp, còn kỳ đã công bố trước giờ mở chỉ trả metadata
   * Không dùng phase lưu DB để cấp quyền vì trạng thái đó có thể chậm hơn lịch thực
   */
  async findOne(id: string, currentUser: CurrentUser) {
    const period = await this.prisma.evaluationPeriod.findUnique({
      where: { id },
      include: { ratingThresholds: true, criteria: { where: { parentId: null } } },
    });
    if (!period || (currentUser.role !== "ADMIN" && !period.publishedAt)) throw this.periodNotFound();
    return this.maskPeriodConfiguration(period, currentUser);
  }

  /** Đọc bộ ngưỡng độc lập và áp dụng cùng chính sách ẩn của kỳ
   * id là mã kỳ còn currentUser xác định quyền Admin hoặc UNIT
   * UNIT nhận lỗi không tìm thấy trước công bố và mảng rỗng trước giờ mở
   */
  async getThresholds(id: string, currentUser: CurrentUser) {
    const period = await this.findOne(id, currentUser);
    return period.ratingThresholds ?? [];
  }

  /** Tạo kỳ ở trạng thái thiết lập và ghi lại người tạo lấy từ phiên đã xác thực
   * dto chứa mốc lịch tùy chọn, tổng điểm và tên/năm do Admin khai báo
   * phase, publishedAt và finalizedAt luôn do nghiệp vụ phía máy chủ quản lý
   * Ghi audit cùng transaction và trả bản ghi mới để FE cấu hình ngưỡng và tiêu chí
   */
  async create(createdById: string, dto: CreateEvaluationPeriodDto) {
    this.assertValidSchedule(dto.selfEvalStart, dto.selfEvalDeadline);
    if (dto.maxTotalScore !== undefined && dto.maxTotalScore <= 0) throw this.businessRule("Tổng điểm tối đa phải lớn hơn 0");
    const now = this.clock.now();
    return this.prisma.$transaction(async (transaction) => {
    const period = await transaction.evaluationPeriod.create({
      data: {
        id: randomUUID(), year: dto.year, name: dto.name, phase: "SETUP",
        maxTotalScore: dto.maxTotalScore ?? 300,
        selfEvalStart: dto.selfEvalStart ? new Date(dto.selfEvalStart) : null,
        selfEvalDeadline: dto.selfEvalDeadline ? new Date(dto.selfEvalDeadline) : null,
        publishedAt: null, finalizedAt: null, createdById,
        createdAt: now, updatedAt: now,
      },
    });
    await this.audit.record({ actorId: createdById, action: "CREATE", entity: "EvaluationPeriod", entityId: period.id, after: this.periodSnapshot(period) }, transaction);
    return period;
    });
  }

  /** Cập nhật cấu hình kỳ và bắt buộc lưu lý do khi Admin đổi lịch của kỳ đã công bố
   * id xác định kỳ còn dto chỉ mang các field có thể cấu hình cùng changeReason
   * Sau khi selfEvalStart đã tới không cho sửa tiêu chí lịch hoặc thang điểm để bảo toàn điểm đã nhập
   * Khóa kỳ trước khi đọc để tránh cạnh tranh công bố hoặc một lần sửa khác
   * Trước khi mở, thay đổi lịch đã công bố cần lý do, audit và hộp thư cùng transaction
   */
  async update(id: string, dto: UpdateEvaluationPeriodDto, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
    await lockPeriod(transaction, id);
    const before = await transaction.evaluationPeriod.findUnique({ where: { id } });
    if (!before) throw this.periodNotFound();
    const start = dto.selfEvalStart === undefined ? before.selfEvalStart : this.dateOrNull(dto.selfEvalStart);
    const deadline = dto.selfEvalDeadline === undefined ? before.selfEvalDeadline : this.dateOrNull(dto.selfEvalDeadline);
    this.assertValidSchedule(start?.toISOString() ?? null, deadline?.toISOString() ?? null);
    if (before.publishedAt && (!start || !deadline)) throw this.businessRule("Kỳ đã công bố phải giữ đủ thời gian mở và thời hạn");
    if (dto.maxTotalScore !== undefined && dto.maxTotalScore <= 0) throw this.businessRule("Tổng điểm tối đa phải lớn hơn 0");
    const now = this.clock.now();
    const scheduleChanged = dto.selfEvalStart !== undefined || dto.selfEvalDeadline !== undefined;
    if (before.publishedAt && (before.phase !== "SETUP" || now >= (before.selfEvalStart ?? new Date(0)))) {
      throw this.businessRule("Không thể thay đổi cấu hình khi kỳ đánh giá đã đến giờ mở");
    }
    if (before.publishedAt && dto.maxTotalScore !== undefined && Number(dto.maxTotalScore) !== Number(before.maxTotalScore)) {
      throw this.businessRule("Không thể thay đổi tổng điểm tối đa sau khi công bố");
    }
    if (before.publishedAt && scheduleChanged && !dto.changeReason?.trim()) {
      throw this.businessRule("Cần ghi rõ lý do khi thay đổi lịch của kỳ đã công bố");
    }
    const { selfEvalStart, selfEvalDeadline, changeReason: _changeReason, ...fields } = dto;
    void _changeReason;
      const after = await transaction.evaluationPeriod.update({
        where: { id },
        data: {
          ...fields,
          ...(selfEvalStart !== undefined && { selfEvalStart: this.dateOrNull(selfEvalStart) }),
          ...(selfEvalDeadline !== undefined && { selfEvalDeadline: this.dateOrNull(selfEvalDeadline) }),
          updatedAt: now,
        },
      });
      await this.audit.record({
        actorId, action: "UPDATE", entity: "EvaluationPeriod", entityId: id,
        before: this.periodSnapshot(before),
        after: { ...this.periodSnapshot(after), ...(scheduleChanged && before.publishedAt ? { changeReason: dto.changeReason!.trim() } : {}) },
      }, transaction);
      if (scheduleChanged && before.publishedAt) {
        const units = await transaction.unit.findMany({ where: { isActive: true }, select: { user: { select: { id: true, isActive: true } } } });
        for (const unit of units) {
          if (!unit.user?.isActive) continue;
          await this.notifications.notifyUser(transaction, {
            userId: unit.user.id, type: "PERIOD_SCHEDULE_UPDATED", title: "Lịch tự chấm đã thay đổi",
            body: `Kỳ ${after.name}: mở lúc ${this.formatVietnamTime(after.selfEvalStart!)}; kết thúc lúc ${this.formatVietnamTime(after.selfEvalDeadline!)}. Lý do: ${dto.changeReason!.trim()}`,
            dedupeKey: `PERIOD_SCHEDULE_UPDATED:${id}:${now.getTime()}`, refType: "EVALUATION_PERIOD", refId: id, channels: [],
          });
        }
      }
      return after;
    });
  }

  /** Công bố cấu hình đã hoàn chỉnh để UNIT có thể thấy tiêu chí đúng thời điểm
   * id là kỳ cần công bố, actorId là Admin thực hiện thao tác
   * Từ chối nếu chưa có lịch hợp lệ, chưa đủ bốn ngưỡng chuẩn hoặc chưa có tiêu chí
   * Khóa kỳ trước khi đọc và kiểm cấu hình, tránh sửa đồng thời tạo snapshot không nhất quán
   * publishedAt được cấp theo đồng hồ máy chủ và audit được ghi cùng hồ sơ trong transaction
   * Cho phép tối đa 30 giây để tạo đủ hồ sơ, điểm lá và thông báo của khoảng 34 đơn vị trong một lần công bố
   * Ngân sách này bao gồm chờ khóa, không cấp quyền theo snapshot trước khóa hoặc chia nhỏ commit
   */
  async publish(id: string, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
    await lockPeriod(transaction, id);
    const period = await transaction.evaluationPeriod.findUnique({
      where: { id }, include: { ratingThresholds: true, criteria: true },
    });
    if (!period) throw this.periodNotFound();
    if (period.publishedAt) throw this.businessRule("Kỳ đánh giá đã được công bố");
    const check = await this.getPublishCheck(id, transaction);
    if (!check.canPublish) {
      throw new UnprocessableEntityException({
        code: ERROR_CODES.PUBLISH_CHECK_FAILED,
        message: "Cấu hình kỳ chưa đủ điều kiện công bố.",
        details: check.checks.filter((item) => !item.passed).map((item) => ({ field: item.code, messages: [item.message] })),
      });
    }
    const now = this.clock.now();
    const units = await transaction.unit.findMany({ where: { isActive: true }, select: { id: true, user: { select: { id: true, isActive: true } } } });
    const leaves = period.criteria.filter((criterion) => !period.criteria.some((candidate) => candidate.parentId === criterion.id));
      const claimed = await transaction.evaluationPeriod.updateMany({
        where: { id, publishedAt: null },
        data: { publishedAt: now, phase: now >= period.selfEvalStart! ? "SELF_EVAL" : "SETUP", updatedAt: now },
      });
      if (claimed.count !== 1) throw this.businessRule("Kỳ đánh giá đã được công bố hoặc đang được công bố");
      const evaluations = units.map((unit) => ({ id: randomUUID(), periodId: id, unitId: unit.id, status: "DRAFT", createdAt: now, updatedAt: now }));
      if (evaluations.length) {
        await transaction.evaluation.createMany({ data: evaluations });
        const scores = evaluations.flatMap((evaluation) => leaves.map((criterion) => ({ id: randomUUID(), evaluationId: evaluation.id, criterionId: criterion.id, createdAt: now, updatedAt: now })));
        if (scores.length) await transaction.criterionScore.createMany({ data: scores });
      }
      await this.audit.record({ actorId, action: "PUBLISH", entity: "EvaluationPeriod", entityId: id, before: this.periodSnapshot(period), after: this.periodSnapshot({ ...period, publishedAt: now, phase: now >= period.selfEvalStart! ? "SELF_EVAL" : "SETUP" }) }, transaction);
      for (const unit of units) {
        if (unit.user?.isActive) {
          await this.notifications.notifyUser(transaction, {
            userId: unit.user.id, type: "PERIOD_PUBLISHED", title: "Kỳ đánh giá đã được công bố",
            body: `Kỳ ${period.name} mở tự chấm lúc ${this.formatVietnamTime(period.selfEvalStart!)} và kết thúc lúc ${this.formatVietnamTime(period.selfEvalDeadline!)}`,
            dedupeKey: `PERIOD_PUBLISHED:${id}`, refType: "EVALUATION_PERIOD", refId: id, channels: [],
          });
        }
      }
      return transaction.evaluationPeriod.findUniqueOrThrow({ where: { id } });
    }, { timeout: 30_000, maxWait: 10_000 });
  }

  /** Trả từng điều kiện công bố để Admin sửa đúng các mục cấu hình còn thiếu
   * id là kỳ cần kiểm tra và truy vấn gồm lịch, tiêu chí, ngưỡng cùng đơn vị hoạt động
   * Kết quả không chứa dữ liệu người dùng hay cấu hình nhạy cảm
   * transaction tùy chọn giúp publish kiểm lại sau khi khóa cùng transaction ghi
   * canPublish chỉ là thông tin; publish luôn kiểm tra lại trước khi ghi
   */
  async getPublishCheck(id: string, transaction: Prisma.TransactionClient = this.prisma) {
    const period = await transaction.evaluationPeriod.findUnique({ where: { id }, include: { ratingThresholds: true, criteria: true } });
    if (!period) throw this.periodNotFound();
    const units = await transaction.unit.count({ where: { isActive: true } });
    const childrenByParent = new Map<string, typeof period.criteria>();
    for (const criterion of period.criteria) {
      if (!criterion.parentId) continue;
      const children = childrenByParent.get(criterion.parentId) ?? [];
      children.push(criterion);
      childrenByParent.set(criterion.parentId, children);
    }
    const leaves = period.criteria.filter((criterion) => !childrenByParent.has(criterion.id));
    const leafTotal = leaves.reduce((sum, criterion) => sum + Number(criterion.maxScore), 0);
    const criteriaById = new Map(period.criteria.map((criterion) => [criterion.id, criterion]));
    // Đếm cạnh khi đi lên từ node hiện tại, tối đa bảy cạnh tương ứng tám cấp
    const hierarchyMatch = period.criteria.every((criterion) => {
      const visited = new Set<string>();
      let cursor: typeof criterion | undefined = criterion;
      let depth = 0;
      while (cursor?.parentId) {
        if (visited.has(cursor.id) || visited.has(cursor.parentId) || ++depth >= 8) return false;
        visited.add(cursor.id);
        const parent = criteriaById.get(cursor.parentId);
        if (!parent) return false;
        cursor = parent;
      }
      return true;
    });
    const groupsMatch = [...childrenByParent].every(([parentId, children]) => {
      const parent = period.criteria.find((criterion) => criterion.id === parentId);
      return parent !== undefined && Math.abs(Number(parent.maxScore) - children.reduce((sum, child) => sum + Number(child.maxScore), 0)) < 0.000001;
    });
    let thresholdsMatch = true;
    try { this.assertThresholdSet(period.ratingThresholds); } catch { thresholdsMatch = false; }
    const checks = [
      { code: "schedule", passed: Boolean(period.selfEvalStart && period.selfEvalDeadline && period.selfEvalStart < period.selfEvalDeadline), message: "Cần đặt thời gian mở và thời hạn hợp lệ, thời gian mở phải sớm hơn thời hạn" },
      { code: "notExpired", passed: Boolean(period.selfEvalDeadline && this.clock.now() < period.selfEvalDeadline), message: "Không thể công bố kỳ đã hết thời gian tự chấm" },
      { code: "unpublished", passed: period.publishedAt === null, message: "Kỳ đánh giá đã được công bố" },
      { code: "criteria", passed: leaves.length > 0 && leaves.every((criterion) => criterion.allowText || criterion.allowFile || criterion.allowLink), message: "Cần có tiêu chí lá và mỗi tiêu chí lá phải cho phép ít nhất một hình thức minh chứng" },
      { code: "hierarchy", passed: hierarchyMatch, message: "Cây tiêu chí phải cùng kỳ, không có vòng lặp và không vượt quá tám cấp" },
      { code: "leafTotal", passed: Math.abs(leafTotal - Number(period.maxTotalScore)) < 0.000001, message: "Tổng điểm tối đa của các tiêu chí lá phải bằng tổng điểm kỳ" },
      { code: "groupTotals", passed: groupsMatch, message: "Điểm tối đa của từng nhóm phải bằng tổng điểm tối đa của các tiêu chí con trực tiếp" },
      { code: "thresholds", passed: thresholdsMatch, message: "Cần đủ bốn ngưỡng EXCELLENT, GOOD, PASS và FAIL theo mức đã quy định" },
      { code: "activeUnits", passed: units > 0, message: "Cần có ít nhất một đơn vị đang hoạt động trước khi công bố" },
    ];
    return { periodId: id, canPublish: checks.every((item) => item.passed), checks };
  }

  /** Xóa kỳ chưa có hồ sơ hoặc báo cáo và giữ toàn bộ thao tác trong transaction
   * id nhận từ route UUID, actorId lấy từ phiên Admin để ghi audit
   * Khóa kỳ trước khi kiểm và từ chối kỳ đã công bố hoặc có dữ liệu tham chiếu
   * Xóa cấu hình và audit cùng transaction để không làm mất dấu vết khi có lỗi
   */
  async remove(id: string, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
    await lockPeriod(transaction, id);
    const period = await transaction.evaluationPeriod.findUnique({
      where: { id }, include: { _count: { select: { evaluations: true, reportExports: true } } },
    });
    if (!period) throw this.periodNotFound();
    if (period.publishedAt) throw this.businessRule("Không thể xóa kỳ đánh giá đã công bố");
    if (period._count.evaluations > 0) throw this.businessRule("Không thể xóa kỳ đánh giá đã có hồ sơ");
    if (period._count.reportExports > 0) throw this.businessRule("Không thể xóa kỳ đánh giá đã có báo cáo được xuất");
      await transaction.ratingThreshold.deleteMany({ where: { periodId: id } });
      await transaction.criterion.deleteMany({ where: { periodId: id } });
      const removed = await transaction.evaluationPeriod.delete({ where: { id } });
      await this.audit.record({ actorId, action: "DELETE", entity: "EvaluationPeriod", entityId: id, before: this.periodSnapshot(period) }, transaction);
      return removed;
    });
  }

  /** Thay toàn bộ ngưỡng bằng đúng bốn mức chuẩn khi kỳ còn ở trạng thái thiết lập
   * periodId xác định kỳ còn thresholds phải chứa mỗi mức một lần với ngưỡng đã thống nhất
   * Transaction khóa kỳ, xóa bộ cũ, tạo bộ mới và ghi audit nguyên tử
   * Không cho sửa sau công bố để kết quả xếp loại luôn dùng cùng một phiên bản ngưỡng
   */
  async upsertThresholds(periodId: string, thresholds: UpsertRatingThresholdDto[], actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
    await lockPeriod(transaction, periodId);
    const period = await transaction.evaluationPeriod.findUnique({ where: { id: periodId }, include: { ratingThresholds: true } });
    if (!period) throw this.periodNotFound();
    if (period.publishedAt) throw this.businessRule("Không thể thay đổi ngưỡng xếp loại sau khi công bố");
    this.assertThresholdSet(thresholds);
      await transaction.ratingThreshold.deleteMany({ where: { periodId } });
      const saved = await Promise.all(thresholds.map((threshold) => transaction.ratingThreshold.create({
        data: { id: randomUUID(), periodId, rating: threshold.rating, label: threshold.label, minPercent: threshold.minPercent, minExclusive: threshold.minExclusive ?? false, color: threshold.color ?? null },
      })));
    await this.audit.record({ actorId, action: "UPSERT_THRESHOLDS", entity: "EvaluationPeriod", entityId: periodId, before: period.ratingThresholds.map((item) => ({ rating: item.rating, label: item.label, minPercent: Number(item.minPercent), minExclusive: item.minExclusive, color: item.color })), after: saved.map((item) => ({ rating: item.rating, label: item.label, minPercent: Number(item.minPercent), minExclusive: item.minExclusive, color: item.color })) }, transaction);
    return saved;
    });
  }

  /** Trả cấu hình nguyên vẹn cho Admin và che nội dung cho UNIT trước lúc kỳ mở
   * period là kết quả Prisma kèm cấu hình, currentUser là chủ thể đã được xác thực
   * Kỳ chưa publish hoặc now nằm trước start luôn trả tiêu chí/ngưỡng rỗng cho UNIT
   * Dùng đồng hồ backend để FE không thể tự cấp quyền bằng giờ trên thiết bị
   */
  private maskPeriodConfiguration<T extends { publishedAt: Date | null; selfEvalStart: Date | null; selfEvalDeadline?: Date | null; maxTotalScore?: unknown; phase?: string; ratingThresholds?: unknown[]; criteria?: unknown[] }>(period: T, currentUser: CurrentUser) {
    const now = this.clock.now();
    if (currentUser.role === "ADMIN") return {
      ...period, serverTime: now.toISOString(),
      canEditConfiguration: !period.publishedAt || (period.phase === "SETUP" && period.selfEvalStart !== null && now < period.selfEvalStart),
    };
    const canView = period.publishedAt !== null && period.selfEvalStart !== null && now >= period.selfEvalStart;
    // Giai đoạn review/đóng là terminal đối với quyền INITIAL, không mở lại bằng lịch bị thay đổi ngoài API
    const selfEvalState = !canView ? "NOT_OPEN_YET" : !["SETUP", "SELF_EVAL"].includes(period.phase ?? "") || !period.selfEvalDeadline || now >= period.selfEvalDeadline ? "CLOSED" : "OPEN";
    return {
      ...period,
      ...(!canView && { maxTotalScore: undefined }),
      ratingThresholds: canView ? period.ratingThresholds : [],
      criteria: canView ? period.criteria : [],
      serverTime: now.toISOString(),
      selfEvalState,
      criteriaVisible: canView,
    };
  }

  /** Dùng cùng quy tắc khi lưu và khi kiểm trước công bố */
  private assertThresholdSet(thresholds: Array<{ rating: string; minPercent: unknown; minExclusive?: boolean; label?: string }>): void {
    assertRatingThresholds(thresholds);
  }

  /** Kiểm tra cặp mốc tự chấm có thứ tự tăng dần khi cả hai cùng được cấu hình
   * start và deadline có thể để trống trong lúc Admin chuẩn bị kỳ
   * Khi đã có cả hai mốc, bắt đầu phải sớm hơn kết thúc để cửa sổ nửa mở luôn hợp lệ
   */
  private assertValidSchedule(start: string | null | undefined, deadline: string | null | undefined): void {
    if (start && deadline && new Date(start) >= new Date(deadline)) throw this.businessRule("Thời gian bắt đầu phải sớm hơn thời hạn tự đánh giá");
  }

  /** Chuyển chuỗi ngày giờ đã qua DTO thành Date hoặc giữ null có chủ đích
   * value là chuỗi ISO hợp lệ hoặc null theo hợp đồng cập nhật
   * Hàm không diễn giải giờ máy khách và không tự đổi mốc thời gian
   */
  private dateOrNull(value: string | null): Date | null {
    return value ? new Date(value) : null;
  }

  /** Hiển thị instant UTC theo ngày giờ Việt Nam trong thông báo nội bộ
   * value là mốc đã lưu trong PostgreSQL dưới dạng UTC
   * Intl nhận múi giờ tường minh để nội dung không phụ thuộc múi giờ tiến trình
   */
  private formatVietnamTime(value: Date): string {
    return `${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value)} (giờ Việt Nam)`;
  }

  /** Tạo snapshot nghiệp vụ không chứa dữ liệu quan hệ hoặc thông tin nhạy cảm
   * period là bản ghi Prisma trước/sau thao tác để phục vụ audit
   * Chuyển Decimal sang number giúp snapshot JSON ổn định và dễ đọc lại
   */
  private periodSnapshot(period: { id: string; year: number; name: string; phase: string; maxTotalScore: unknown; selfEvalStart: Date | null; selfEvalDeadline: Date | null; publishedAt: Date | null }): Prisma.InputJsonObject {
    return { id: period.id, year: period.year, name: period.name, phase: period.phase, maxTotalScore: Number(period.maxTotalScore), selfEvalStart: period.selfEvalStart?.toISOString() ?? null, selfEvalDeadline: period.selfEvalDeadline?.toISOString() ?? null, publishedAt: period.publishedAt?.toISOString() ?? null };
  }

  /** Chuẩn hóa lỗi không tìm thấy kỳ để không lộ lỗi truy vấn nội bộ
   * Không nhận input và không kèm thông điệp Prisma/SQL trong phản hồi
   */
  private periodNotFound(): NotFoundException {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: "Không tìm thấy kỳ đánh giá" });
  }

  /** Tạo lỗi nghiệp vụ có mã ổn định và thông điệp dành cho người dùng tiếng Việt
   * message chỉ được gọi từ các nhánh kiểm tra do ứng dụng kiểm soát
   * Không chuyển nguyên lỗi của PostgreSQL hoặc Prisma ra API
   */
  private businessRule(message: string): BadRequestException {
    return new BadRequestException({ code: ERROR_CODES.BUSINESS_RULE_VIOLATION, message });
  }
}
