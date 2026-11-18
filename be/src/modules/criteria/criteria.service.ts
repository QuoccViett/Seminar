import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ERROR_CODES } from "../../common/constants/error-codes.js";
import { AuditService } from "../../common/services/audit.service.js";
import { ClockService } from "../../common/services/clock.service.js";
import { lockPeriod } from "../../common/services/period-lock.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import type { CreateCriterionDto } from "./dto/create-criterion.dto.js";
import type { UpdateCriterionDto } from "./dto/update-criterion.dto.js";

@Injectable()
export class CriteriaService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly clock: ClockService) {}

  /** Định vị kỳ từ tiêu chí trước khi gọi use-case sửa đã có khóa và audit
   * id là UUID tiêu chí, dto không nhận periodId nên không thể chuyển tiêu chí sang kỳ khác
   * Use-case đọc lại sau khóa, bản ghi không còn tồn tại thì vẫn trả 404 an toàn
   */
  async updateById(id: string, dto: UpdateCriterionDto, actorId: string) {
    const criterion = await this.prisma.criterion.findUnique({ where: { id }, select: { periodId: true } });
    if (!criterion) throw this.notFound("Không tìm thấy tiêu chí");
    return this.update(criterion.periodId, id, dto, actorId);
  }

  /** Định vị kỳ cho route xóa phẳng và giữ duy nhất một luồng kiểm dữ liệu phụ thuộc
   * Chỉ trả bản ghi xóa sau transaction thành công, không bỏ qua khóa công bố của kỳ
   */
  async removeById(id: string, actorId: string) {
    const criterion = await this.prisma.criterion.findUnique({ where: { id }, select: { periodId: true } });
    if (!criterion) throw this.notFound("Không tìm thấy tiêu chí");
    return this.remove(criterion.periodId, id, actorId);
  }

  /** Đọc cây tiêu chí của một kỳ sau khi kiểm tra thời điểm công bố ở backend
   * periodId đến từ route, currentUser đến từ token đã xác thực
   * Khóa kỳ trong transaction để lịch không thể thay đổi giữa kiểm quyền và đọc cây
   * UNIT gọi kỳ chưa công bố nhận 404, còn trước giờ mở nhận NOT_OPEN_YET để không dò nội dung
   * ADMIN vẫn xem được cấu hình nháp để chuẩn bị và kiểm tra kỳ
   */
  async findByPeriod(periodId: string, currentUser: CurrentUser) {
    return this.prisma.$transaction(async (tx) => {
    await lockPeriod(tx, periodId);
    const period = await tx.evaluationPeriod.findUnique({ where: { id: periodId }, select: { id: true, publishedAt: true, selfEvalStart: true } });
    if (!period) throw this.notFound("Không tìm thấy kỳ đánh giá");
    if (currentUser.role !== "ADMIN" && !period.publishedAt) throw this.notFound("Không tìm thấy kỳ đánh giá");
    if (currentUser.role !== "ADMIN" && (!period.selfEvalStart || this.clock.now() < period.selfEvalStart)) {
      throw new BadRequestException({ code: ERROR_CODES.NOT_OPEN_YET, message: "Kỳ đánh giá chưa đến thời gian mở tiêu chí." });
    }
    const criteria = await tx.criterion.findMany({ where: { periodId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    const nodes = criteria.map((criterion) => ({ ...criterion, children: [] as typeof criteria }));
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const roots: typeof nodes = [];
    for (const node of nodes) {
      const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
    });
  }

  /** Tạo tiêu chí trong kỳ đang thiết lập và ghi audit cùng transaction
   * periodId lấy từ route còn dto chỉ chứa nội dung và cách nhập minh chứng
   * Khóa kỳ trước khi kiểm trạng thái để công bố đồng thời không lọt qua kiểm tra
   * Chặn điểm không dương, kỳ không tồn tại/đã công bố và parentId khác kỳ
   * Trả bản ghi đã tạo để FE có thể tải lại cây tiêu chí
   */
  async create(periodId: string, dto: CreateCriterionDto, actorId: string) {
    this.assertPositiveScore(dto.maxScore);
    return this.prisma.$transaction(async (tx) => {
    await lockPeriod(tx, periodId);
    const period = await this.getEditablePeriod(tx, periodId);
    if (dto.parentId) await this.assertParentPeriod(tx, dto.parentId, period.id);
    const now = this.clock.now();
    const created = await tx.criterion.create({
      data: {
        id: randomUUID(), periodId, parentId: dto.parentId ?? null, code: dto.code, name: dto.name,
        description: dto.description ?? null, maxScore: dto.maxScore,
        evidenceRequirement: dto.evidenceRequirement ?? null, allowText: dto.allowText ?? true,
        allowFile: dto.allowFile ?? true, allowLink: dto.allowLink ?? true,
        evidenceRequired: dto.evidenceRequired ?? true, sortOrder: dto.sortOrder,
        createdAt: now, updatedAt: now,
      },
    });
    await this.audit.record({ actorId, action: "CREATE", entity: "Criterion", entityId: created.id, after: this.snapshot(created) }, tx);
    return created;
    });
  }

  /** Sửa thông tin tiêu chí nháp mà không cho thay kỳ hoặc sửa đã công bố
   * periodId và id xác định đúng tiêu chí, dto chứa field được phép thay
   * Khóa kỳ trước khi kiểm công bố, điểm và cha cùng kỳ để tránh sửa đồng thời
   * Audit cùng transaction lưu snapshot trước/sau hoặc rollback toàn bộ khi ghi lỗi
   */
  async update(periodId: string, id: string, dto: UpdateCriterionDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
    await lockPeriod(tx, periodId);
    await this.getEditablePeriod(tx, periodId);
    const before = await tx.criterion.findUnique({ where: { id } });
    if (!before || before.periodId !== periodId) throw this.notFound("Không tìm thấy tiêu chí");
    if (dto.maxScore !== undefined) this.assertPositiveScore(dto.maxScore);
    if (dto.parentId) await this.assertParentPeriod(tx, dto.parentId, before.periodId, id);
    const after = await tx.criterion.update({ where: { id }, data: { ...dto, updatedAt: this.clock.now() } });
    await this.audit.record({ actorId, action: "UPDATE", entity: "Criterion", entityId: id, before: this.snapshot(before), after: this.snapshot(after) }, tx);
    return after;
    });
  }

  /** Xóa tiêu chí chưa được công bố và chưa có dữ liệu con/điểm tham chiếu
   * periodId và id từ route xác định tiêu chí còn actorId nhận từ phiên Admin
   * Khóa kỳ trước khi kiểm công bố, có con hoặc điểm thì từ chối để giữ lịch sử
   * Audit và thao tác xóa cùng commit hoặc rollback để tránh thiếu dấu vết
   */
  async remove(periodId: string, id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
    await lockPeriod(tx, periodId);
    await this.getEditablePeriod(tx, periodId);
    const criterion = await tx.criterion.findUnique({ where: { id }, select: { id: true, periodId: true, code: true, name: true, _count: { select: { children: true, scores: true } } } });
    if (!criterion || criterion.periodId !== periodId) throw this.notFound("Không tìm thấy tiêu chí");
    if (criterion._count.children > 0 || criterion._count.scores > 0) throw this.businessRule("Không thể xóa tiêu chí đang có tiêu chí con hoặc kết quả đánh giá");
    const removed = await tx.criterion.delete({ where: { id } });
    await this.audit.record({ actorId, action: "DELETE", entity: "Criterion", entityId: id, before: { id, periodId: criterion.periodId, code: criterion.code, name: criterion.name } }, tx);
    return removed;
    });
  }

  /** Xác nhận kỳ tồn tại và chưa được công bố trước thao tác ghi tiêu chí
   * tx là transaction đang giữ khóa kỳ, periodId dùng để đọc mốc công bố
   * Khi publishedAt đã có mọi chỉnh sửa bị khóa để thang điểm không đổi sau khi công bố
   */
  private async getEditablePeriod(tx: Prisma.TransactionClient, periodId: string) {
    const period = await tx.evaluationPeriod.findUnique({ where: { id: periodId }, select: { id: true, publishedAt: true } });
    if (!period) throw this.notFound("Không tìm thấy kỳ đánh giá");
    if (period.publishedAt) throw this.businessRule("Không thể thay đổi tiêu chí sau khi công bố kỳ đánh giá");
    return period;
  }

  /** Bảo đảm chuỗi cha cùng kỳ, không tạo vòng lặp và không vượt quá tám cấp
   * parentId là cha được chọn, periodId là kỳ đích, criterionId là node đang sửa nếu có
   * Mỗi bước đi lên đều đọc parentId từ DB để phát hiện cả vòng lặp đã tồn tại
   * Khi di chuyển một nhánh, tính cả con cháu để không đưa các node xuống quá tám cấp
   */
  private async assertParentPeriod(tx: Prisma.TransactionClient, parentId: string, periodId: string, criterionId?: string): Promise<void> {
    const visited = new Set(criterionId ? [criterionId] : []);
    let currentId: string | null = parentId;
    // Tính cả node đang tạo/sửa vì chỉ đếm parent có thể tạo cấp thứ 9
    let depth = 1;
    while (currentId) {
      if (visited.has(currentId)) throw this.businessRule("Không thể tạo vòng lặp trong cây tiêu chí");
      visited.add(currentId);
      depth += 1;
      if (depth > 8) throw this.businessRule("Cây tiêu chí không được vượt quá tám cấp");
      const parent: { id: string; periodId: string; parentId: string | null } | null = await tx.criterion.findUnique({ where: { id: currentId }, select: { id: true, periodId: true, parentId: true } });
      if (!parent || parent.periodId !== periodId) throw this.businessRule("Tiêu chí cha phải thuộc cùng kỳ đánh giá");
      currentId = parent.parentId;
    }
    if (criterionId) {
      const nodes = await tx.criterion.findMany({ where: { periodId }, select: { id: true, parentId: true } });
      const pending = [{ id: criterionId, depth }];
      const descendants = new Set<string>();
      while (pending.length) {
        const node = pending.pop()!;
        if (descendants.has(node.id) || node.depth > 8) throw this.businessRule("Cây tiêu chí không được có vòng lặp hoặc vượt quá tám cấp");
        descendants.add(node.id);
        for (const child of nodes) {
          if (child.parentId === node.id) pending.push({ id: child.id, depth: node.depth + 1 });
        }
      }
    }
  }

  /** Chỉ nhận điểm tối đa dương phù hợp ràng buộc PostgreSQL
   * score là giá trị thập phân gửi từ DTO
   * Không chấp nhận số âm, 0 hoặc giá trị không hữu hạn
   */
  private assertPositiveScore(score: number): void {
    if (!Number.isFinite(score) || score <= 0) throw this.businessRule("Điểm tối đa phải lớn hơn 0");
  }

  /** Tạo snapshot cấu hình gọn để audit mà không lưu dữ liệu quan hệ
   * criterion là bản ghi đã đọc hoặc đã ghi
   * Decimal được chuẩn hóa thành number và các field cho phép chấm được giữ đầy đủ
   */
  private snapshot(criterion: { id: string; periodId: string; parentId: string | null; code: string; name: string; description: string | null; maxScore: unknown; allowText: boolean; allowFile: boolean; allowLink: boolean; evidenceRequired: boolean; sortOrder: number }): Prisma.InputJsonValue {
    return { id: criterion.id, periodId: criterion.periodId, parentId: criterion.parentId, code: criterion.code, name: criterion.name, description: criterion.description, maxScore: Number(criterion.maxScore), allowText: criterion.allowText, allowFile: criterion.allowFile, allowLink: criterion.allowLink, evidenceRequired: criterion.evidenceRequired, sortOrder: criterion.sortOrder };
  }

  /** Tạo lỗi không tìm thấy tiếng Việt với mã API ổn định
   * message là thông điệp nghiệp vụ nội bộ đã được kiểm soát
   * Không trả nội dung query hoặc thông báo SQL cho client
   */
  private notFound(message: string): NotFoundException {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message });
  }

  /** Tạo lỗi quy tắc nghiệp vụ có thông điệp tiếng Việt
   * message chỉ nhận chuỗi do service định nghĩa tại các nhánh đã kiểm tra
   * Phản hồi không chứa lỗi thô từ Prisma hoặc nhà cung cấp ngoài
   */
  private businessRule(message: string): BadRequestException {
    return new BadRequestException({ code: ERROR_CODES.BUSINESS_RULE_VIOLATION, message });
  }
}
