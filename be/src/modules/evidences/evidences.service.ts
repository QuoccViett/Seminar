import { ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter.js";
import { AuditService } from "../../common/services/audit.service.js";
import { lockPeriod } from "../../common/services/period-lock.js";
import { Prisma, type Evidence, type EvidenceUpload } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { selfLockedReason } from "../evaluations/evaluation-policy.js";
import { EvaluationStateService } from "../evaluations/evaluation-state.service.js";
import type { EvidenceBatchDto, EvidenceItemDto, UploadBatchDto, UploadItemDto } from "./dto/evidence.dto.js";
import { checkFile, checkMetadata, invalidFile, MAX_RECORD_BYTES, safeExternalUrl } from "./file-policy.js";
import { StorageProvider } from "./storage.provider.js";

const include = { period: { include: { criteria: true } }, criterionScores: { include: { evidences: true } } } satisfies Prisma.EvaluationInclude;
type Context = Prisma.EvaluationGetPayload<{ include: typeof include }>;
type Score = Context["criterionScores"][number];

/** Điều phối minh chứng và storage không có transaction phân tán
 * Dùng reservation, key pending/final và tombstone để bù lỗi, không coi object chờ là minh chứng
 * Mọi ghi giữ khóa kỳ trước hồ sơ, cùng thứ tự VC09 để tuần tự với nộp/chuyển phase/cleanup
 */
@Injectable()
export class EvidencesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvidencesService.name);
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;

  /** Tiêm rõ dependency theo mẫu Auth để runtime ESM và bản build dùng cùng luồng */
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EvaluationStateService) private readonly state: EvaluationStateService,
    @Inject(StorageProvider) private readonly storage: StorageProvider,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /** Chỉ khởi động dọn object khi storage bật, không chạy job nghiệp vụ kỳ thuộc VC11
   * unref tránh giữ tiến trình test; lỗi ghi câu cố định, không ghi key/URL/provider
   */
  onModuleInit(): void {
    if (!this.config.get<boolean>("STORAGE_ENABLED")) return;
    this.timer = setInterval(() => { void this.cleanup().catch(() => this.logger.warn("Chưa dọn được tệp chờ, hệ thống sẽ thử lại")); }, 60000);
    this.timer.unref();
  }

  /** Hủy timer khi đóng Nest để không còn công việc dọn mới trên connection đã đóng */
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** Lỗi chung 404 che sự tồn tại của hồ sơ, tiêu chí hoặc minh chứng ngoài phạm vi */
  private missing(): NotFoundException { return new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy minh chứng hoặc hồ sơ được phép truy cập" }); }

  /** Chuẩn hóa lỗi nghiệp vụ dự kiến, không chèn tên key hoặc lỗi provider vào câu trả về */
  private rule(message: string, code = "EVIDENCE_RULE_VIOLATION"): UnprocessableEntityException { return new UnprocessableEntityException({ code, message }); }

  /** Giới hạn UNIT bằng đơn vị thật và kỳ đã công bố ngay trong truy vấn */
  private scope(user: CurrentUser): Prisma.EvaluationWhereInput {
    return user.role === "ADMIN" ? {} : { unitId: user.unitId ?? "00000000-0000-4000-8000-000000000000", period: { publishedAt: { not: null } } };
  }

  /** Khóa và đọc snapshot theo danh tính, lấy giờ DB sau chờ khóa, reconcile dù request bị từ chối
   * Chỉ lỗi HTTP dự kiến được commit reconcile, lỗi DB/audit phải rollback toàn bộ
   * Transaction dài hơn upload tối đa có timeout để provider hỏng không giữ khóa vô hạn
   */
  private async run<T>(id: string, user: CurrentUser, work: (tx: Prisma.TransactionClient, context: Context) => Promise<T>): Promise<T> {
    const result = await this.prisma.$transaction(async (tx) => {
      const ref = await tx.evaluation.findFirst({ where: { id, ...this.scope(user) }, select: { periodId: true } });
      if (!ref) throw this.missing();
      await lockPeriod(tx, ref.periodId, "shared");
      await tx.$queryRaw`SELECT id FROM evaluations WHERE id = ${id}::uuid FOR UPDATE`;
      const context = await tx.evaluation.findFirst({ where: { id, ...this.scope(user) }, include });
      if (!context) throw this.missing();
      Object.assign(context, await this.state.reconcileInitial(tx, context, context.period, await this.state.databaseNow(tx)));
      Object.assign(context, await this.state.reconcileSupplement(tx, context, context.period, await this.state.databaseNow(tx)));
      try { return { value: await work(tx, context) }; }
      catch (error) {
        if (!(error instanceof HttpException)) throw error;
        await this.state.reconcileInitial(tx, context, context.period, await this.state.databaseNow(tx));
        await this.state.reconcileSupplement(tx, context, context.period, await this.state.databaseNow(tx));
        return { error };
      }
    }, { timeout: 60000, maxWait: 10000 });
    if (result.error) throw result.error;
    return result.value as T;
  }

  /** Tìm lá và quyền ghi bằng snapshot server, không tin round hoặc scoreId từ request
   * ADMIN chỉ đọc; tiêu chí ngoài kỳ, nhóm hoặc score thiếu bị chặn trước chạm storage
   */
  private async writable(tx: Prisma.TransactionClient, context: Context, criterionId: string, user: CurrentUser) {
    if (user.role !== "UNIT") throw new ForbiddenException({ code: "FORBIDDEN", message: "Chỉ đơn vị được thay đổi minh chứng tự chấm" });
    const criterion = context.period.criteria.find((row) => row.id === criterionId);
    const score = context.criterionScores.find((row) => row.criterionId === criterionId);
    if (!criterion || !score) throw this.missing();
    if (context.period.criteria.some((row) => row.parentId === criterionId)) throw this.rule("Chỉ được gắn minh chứng vào tiêu chí lá");
    const now = await this.state.databaseNow(tx);
    // Khóa upload, xác nhận và xóa tại đúng deadline dựa trên giờ DB, kể cả khi job trễ
    // Hồ sơ đã nộp sớm không bị gán nhầm lỗi quá hạn và vẫn dùng lý do khóa thông thường
    if (context.status === "SUPPLEMENT_EXPIRED" || context.status === "SUPPLEMENT_REQUESTED" && context.supplementDeadline && now >= context.supplementDeadline) throw new ForbiddenException({ code: "DEADLINE_PASSED", message: "Đã hết thời gian bổ sung hồ sơ" });
    const reason = selfLockedReason(context.period, context, now, score.needsSupplement);
    if (reason) throw new ForbiddenException({ code: "EVALUATION_LOCKED", message: reason });
    return { criterion, score, now, round: context.status === "DRAFT" ? "INITIAL" : "SUPPLEMENT" };
  }

  /** Áp quota cả object đã xác nhận và reservation sống trong cùng khóa hồ sơ
   * exclude dùng khi confirm để không đếm hai lần phiên đang chuyển từ pending sang Evidence
   */
  private async quota(tx: Prisma.TransactionClient, context: Context, score: Score, bytes: bigint, exclude?: string): Promise<void> {
    const now = await this.state.databaseNow(tx);
    const pending = await tx.evidenceUpload.findMany({ where: { criterionScore: { evaluationId: context.id }, state: "PENDING", expiresAt: { gt: now }, ...(exclude ? { id: { not: exclude } } : {}) } });
    const evidences = context.criterionScores.flatMap((row) => row.evidences).filter((row) => row.kind === "FILE");
    if (evidences.filter((row) => row.criterionScoreId === score.id).length + pending.filter((row) => row.criterionScoreId === score.id).length >= 10) throw this.rule("Mỗi tiêu chí chỉ được có tối đa 10 tệp kể cả tệp đang chờ", "EVIDENCE_QUOTA_EXCEEDED");
    const total = [...evidences, ...pending].reduce((sum, row) => sum + (row.sizeBytes ?? 0n), bytes);
    if (total > BigInt(MAX_RECORD_BYTES)) throw this.rule("Tổng dung lượng hồ sơ kể cả tệp chờ không được vượt quá 100 MiB", "EVIDENCE_QUOTA_EXCEEDED");
  }

  /** Tạo token HMAC ràng buộc operation/id/expiry, tách miền với JWT access để không dùng chéo
   * Token không chứa key storage, thời hạn ngắn và chữ ký kiểm constant-time
   */
  private token(operation: string, id: string, expiry: number): string {
    const signature = createHmac("sha256", this.config.getOrThrow<string>("JWT_SECRET")).update(`vc10:${operation}:${id}:${expiry}`).digest("base64url");
    return `${expiry}.${signature}`;
  }

  /** Kiểm chữ ký trước đọc bytes, deadline token dùng giờ server còn quyền ghi luôn dùng giờ DB
   * Không phản chiếu token sai trong lỗi và không cho endpoint đọc dùng token upload
   * Không so TTL tối đa với giờ máy ứng dụng vì issuer upload lấy giờ DB có thể lệch vài giây
   * Client không thể kéo dài expiry đã ký, phiên upload vẫn kiểm deadline bằng cùng đồng hồ DB
   */
  verifyToken(operation: string, id: string, token: string): void {
    const supplied = typeof token === "string" ? token : "";
    const expiry = Number(supplied.split(".")[0]);
    const expected = this.token(operation, id, expiry);
    // Query có thể lặp thành mảng hoặc chứa Unicode, phải so số byte trước timingSafeEqual để không ném RangeError
    const suppliedBytes = Buffer.from(supplied); const expectedBytes = Buffer.from(expected);
    if (!Number.isSafeInteger(expiry) || expiry <= Date.now() || suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) throw new ForbiddenException({ code: "SIGNED_URL_EXPIRED", message: "Liên kết tệp không hợp lệ hoặc đã hết hạn, vui lòng xin liên kết mới" });
  }

  /** Sinh URL tương đối tránh tin Host header, FE nối theo origin backend đã cấu hình */
  private signedUrl(operation: string, id: string, expiry: number): string {
    return `/api/v1/storage/${operation === "upload" ? "uploads" : "files"}/${id}?operation=${operation}&token=${this.token(operation, id, expiry)}`;
  }

  /** Chạy batch tuần tự và chuẩn hóa lỗi từng phần tử sau transaction rollback
   * Không nuốt lỗi DB thành thành công, chỉ các item ok mới có data để FE tiếp tục
   */
  private async batch<T, U>(items: T[], work: (item: T) => Promise<U>) {
    const results = [];
    for (const [index, item] of items.entries()) {
      try { results.push({ index, ok: true, data: await work(item) }); }
      catch (error) { results.push({ index, ok: false, error: new AllExceptionsFilter().toApiError(error) }); }
    }
    return { results };
  }

  /** Xin reservation từng tệp, quota được giữ trước khi cấp URL để batch/race không vượt giới hạn */
  uploads(id: string, dto: UploadBatchDto, user: CurrentUser) {
    return this.batch(dto.items, (item) => this.reserve(id, item, user));
  }

  /** Dành key pending/final từ UUID server, phiên giữ version mật khẩu tại lúc xin tải
   * Storage tắt trả lỗi riêng, metadata sai không chiếm quota; expiresAt do server cấp
   */
  private reserve(id: string, item: UploadItemDto, user: CurrentUser) {
    return this.run(id, user, async (tx, context) => {
      const { criterion, score, now, round } = await this.writable(tx, context, item.criterionId, user);
      if (!criterion.allowFile) throw this.rule("Tiêu chí này không cho phép minh chứng bằng tệp");
      this.storage.assertEnabled(); checkMetadata(item.fileName, item.mimeType);
      await this.quota(tx, context, score, BigInt(item.sizeBytes));
      const actor = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const uploadId = randomUUID(); const expiresAt = new Date(+now + 300000);
      await tx.evidenceUpload.create({ data: { id: uploadId, criterionScoreId: score.id, uploaderId: user.id, credentialVersion: actor.credentialVersion,
        round, fileName: item.fileName, mimeType: item.mimeType, sizeBytes: BigInt(item.sizeBytes),
        pendingPath: `pending/${id}/${uploadId}`, finalPath: `final/${id}/${uploadId}`, expiresAt, createdAt: now } });
      return { uploadId, uploadUrl: this.signedUrl("upload", uploadId, +expiresAt), method: "PUT", requiredHeaders: { "Content-Type": item.mimeType }, expiresAt: expiresAt.toISOString() };
    });
  }

  /** Nhận bytes qua capability nhưng kiểm lại phiên, version, owner và cửa sổ trong transaction
   * Upload chỉ ghi pending; lần tải lặp sau confirm bị chặn nên không sửa được bytes đã nộp
   */
  async uploadBytes(uploadId: string, token: string, bytes: Buffer, mimeType: string) {
    this.verifyToken("upload", uploadId, token);
    const ref = await this.prisma.evidenceUpload.findUnique({ where: { id: uploadId }, include: { uploader: true, criterionScore: true } });
    if (!ref) throw this.missing();
    const user = { id: ref.uploaderId, role: "UNIT" as const, unitId: ref.uploader.unitId };
    return this.run(ref.criterionScore.evaluationId, user, async (tx, context) => {
      const pending = await tx.evidenceUpload.findUniqueOrThrow({ where: { id: uploadId }, include: { uploader: true } });
      const { now, round } = await this.writable(tx, context, ref.criterionScore.criterionId, user);
      if (pending.state !== "PENDING" || now >= pending.expiresAt || pending.round !== round || !pending.uploader.isActive || pending.uploader.role !== "UNIT" || pending.uploader.mustChangePassword || pending.uploader.credentialVersion !== pending.credentialVersion) throw this.rule("Phiên tải đã hết hiệu lực hoặc tài khoản đã thay đổi", "UPLOAD_EXPIRED");
      if (mimeType !== pending.mimeType) throw invalidFile();
      await checkFile(bytes, pending.fileName, pending.mimeType, Number(pending.sizeBytes));
      await this.storage.put(pending.pendingPath, bytes, pending.mimeType);
      // I/O có thể vượt deadline, kiểm lại sau khi ghi vùng chờ trước khi báo upload thành công
      // Bytes chưa xác nhận không trở thành minh chứng và vẫn được cleanup bù khi request bị khóa
      await this.writable(tx, context, ref.criterionScore.criterionId, user);
      return { message: "Đã tải tệp vào vùng chờ xác nhận" };
    });
  }

  /** Xác nhận mỗi FILE/LINK độc lập, HTTP 200 vẫn có thể chứa lỗi theo từng item */
  create(id: string, dto: EvidenceBatchDto, user: CurrentUser) {
    return this.batch(dto.items, (item) => this.confirm(id, item, user));
  }

  /** Kiểm object thật, chuyển final rồi ghi Evidence/audit nguyên tử với trạng thái CONFIRMED
   * Lỗi sau copy giữ PENDING và cả hai key để cleanup bù; retry cùng uploadId trả Evidence cũ
   * Recheck giờ sau I/O, chỉ object hợp lệ và còn quyền mới trở thành minh chứng
   */
  private confirm(id: string, item: EvidenceItemDto, user: CurrentUser) {
    return this.run(id, user, async (tx, context) => {
      const { criterion, score, round } = await this.writable(tx, context, item.criterionId, user);
      let pending: EvidenceUpload | null = null; let externalUrl: string | null = null;
      if (item.kind === "LINK") {
        if (!criterion.allowLink || item.uploadId !== undefined) throw this.rule("Tiêu chí hoặc dữ liệu không cho phép tạo minh chứng liên kết");
        externalUrl = safeExternalUrl(item.externalUrl ?? "");
        if (score.evidences.filter((row) => row.kind === "LINK").length >= 20) throw this.rule("Mỗi tiêu chí chỉ được có tối đa 20 liên kết", "EVIDENCE_QUOTA_EXCEEDED");
      } else {
        if (!criterion.allowFile || item.externalUrl !== undefined) throw this.rule("Tiêu chí hoặc dữ liệu không cho phép tạo minh chứng tệp");
        pending = await tx.evidenceUpload.findFirst({ where: { id: item.uploadId, criterionScoreId: score.id, uploaderId: user.id } });
        if (!pending) throw this.missing();
        if (pending.round !== round) throw this.rule("Phiên tải không thuộc lượt minh chứng hiện tại", "UPLOAD_ROUND_MISMATCH");
        if (pending.state === "CONFIRMED") {
          const existing = score.evidences.find((row) => row.id === pending!.id);
          if (!existing) throw this.missing();
          return this.present(existing, true);
        }
        const actor = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        if (pending.state !== "PENDING" || (await this.state.databaseNow(tx)) >= pending.expiresAt || actor.credentialVersion !== pending.credentialVersion) throw this.rule("Phiên tải đã hết hạn hoặc bị hủy, vui lòng chọn lại tệp", "UPLOAD_EXPIRED");
        await this.quota(tx, context, score, pending.sizeBytes, pending.id);
        const bytes = await this.storage.get(pending.pendingPath);
        if (!bytes) throw this.rule("Tệp chưa có trong kho, vui lòng tải tệp trước khi xác nhận", "UPLOAD_NOT_FOUND");
        await checkFile(bytes, pending.fileName, pending.mimeType, Number(pending.sizeBytes));
        await this.storage.put(pending.finalPath, bytes, pending.mimeType);
      }
      const { now } = await this.writable(tx, context, item.criterionId, user);
      const evidence = await tx.evidence.create({ data: { id: pending?.id ?? randomUUID(), criterionScoreId: score.id, uploaderId: user.id, kind: item.kind, round,
        fileName: pending?.fileName, mimeType: pending?.mimeType, sizeBytes: pending?.sizeBytes, storagePath: pending?.finalPath, externalUrl, description: item.description ?? null, createdAt: now } });
      // Minh chứng bổ sung thay đổi cơ sở thẩm định, điểm duyệt cũ phải được xem lại
      // Audit điểm cũ trước khi xóa để lịch sử giải thích vì sao ô trở về chưa duyệt
      if (round === "SUPPLEMENT" && score.adminScore !== null) {
        await tx.criterionScore.update({ where: { id: score.id }, data: { adminScore: null, adminComment: null, reviewedById: null, reviewedAt: null, updatedAt: now } });
        await this.audit.record({ actorId: user.id, action: "REVIEW_INVALIDATED", entity: "CriterionScore", entityId: score.id, before: { adminScore: score.adminScore.toString(), adminComment: score.adminComment }, after: { adminScore: null, adminComment: null } }, tx);
      }
      if (pending) await tx.evidenceUpload.update({ where: { id: pending.id }, data: { state: "CONFIRMED" } });
      await this.audit.record({ actorId: user.id, action: "CREATE", entity: "Evidence", entityId: evidence.id,
        after: { evaluationId: id, criterionId: item.criterionId, kind: evidence.kind, round, fileName: evidence.fileName, sizeBytes: evidence.sizeBytes?.toString() ?? null } }, tx);
      return this.present(evidence, true);
    });
  }

  /** Project metadata công khai, canDelete tính từ policy hiện tại chứ không từ giờ máy FE */
  private present(evidence: Evidence, canDelete: boolean) {
    return { id: evidence.id, kind: evidence.kind, round: evidence.round, fileName: evidence.fileName, mimeType: evidence.mimeType,
      sizeBytes: evidence.sizeBytes?.toString() ?? null, externalUrl: evidence.externalUrl, description: evidence.description, previewStatus: evidence.previewStatus, createdAt: evidence.createdAt.toISOString(), canDelete };
  }

  /** Tìm minh chứng sau kiểm mở tiêu chí, không để đường đọc URL làm lộ dữ liệu trước start */
  private async readable(tx: Prisma.TransactionClient, context: Context, evidenceId: string, user: CurrentUser) {
    const now = await this.state.databaseNow(tx);
    if (user.role === "UNIT" && (!context.period.selfEvalStart || now < context.period.selfEvalStart)) throw new ForbiddenException({ code: "NOT_OPEN_YET", message: "Chưa đến giờ mở minh chứng của kỳ đánh giá" });
    const score = context.criterionScores.find((row) => row.evidences.some((item) => item.id === evidenceId));
    const evidence = score?.evidences.find((item) => item.id === evidenceId);
    if (!score || !evidence) throw this.missing();
    const canDelete = user.role === "UNIT" && selfLockedReason(context.period, context, now, score.needsSupplement) === null && (context.status === "DRAFT" || evidence.round === "SUPPLEMENT");
    return { evidence, score, canDelete };
  }

  /** Cấp URL đọc ngắn sau kiểm quyền, Word chỉ được tải còn ảnh/PDF được xem inline
   * Không trả key storage và không tạo URL cho LINK vì địa chỉ ngoài đã là metadata thuần
   */
  read(id: string, evidenceId: string, user: CurrentUser, preview = false) {
    return this.run(id, user, async (tx, context) => {
      const { evidence, canDelete } = await this.readable(tx, context, evidenceId, user);
      if (preview && (evidence.kind !== "FILE" || !["image/jpeg", "image/png", "application/pdf"].includes(evidence.mimeType ?? ""))) throw this.rule("Loại minh chứng này không hỗ trợ xem trước, vui lòng tải tệp để mở", "PREVIEW_NOT_AVAILABLE");
      const expiresAt = new Date(Date.now() + 120000);
      const url = evidence.kind === "FILE" ? this.signedUrl(preview ? "preview" : "download", evidenceId, +expiresAt) : null;
      return preview ? { url, mimeType: evidence.mimeType, expiresAt: expiresAt.toISOString() }
        : { ...this.present(evidence, canDelete), downloadUrl: url, expiresAt: url ? expiresAt.toISOString() : null };
    });
  }

  /** Đọc bytes bằng capability giới hạn operation, chỉ Evidence đã commit mới có đường tải
   * Preview không nhận Word, metadata bị xóa làm URL cũ trả 404 dù chữ ký còn hạn
   */
  async bytes(id: string, operation: string, token: string) {
    if (!["download", "preview"].includes(operation)) throw this.missing();
    this.verifyToken(operation, id, token);
    const evidence = await this.prisma.evidence.findUnique({ where: { id } });
    if (!evidence?.storagePath || evidence.kind !== "FILE") throw this.missing();
    if (operation === "preview" && !["image/jpeg", "image/png", "application/pdf"].includes(evidence.mimeType ?? "")) throw this.missing();
    const bytes = await this.storage.get(evidence.storagePath);
    if (!bytes) throw this.missing();
    return { bytes, mimeType: evidence.mimeType!, fileName: evidence.fileName! };
  }

  /** Xóa metadata và ghi tombstone/audit trong cùng transaction, không xóa object trước commit
   * Bảo vệ INITIAL khi đang bổ sung và không cho thao tác xóa trở thành đường vượt trạng thái
   */
  async remove(id: string, evidenceId: string, user: CurrentUser) {
    await this.run(id, user, async (tx, context) => {
      const { evidence, score, canDelete } = await this.readable(tx, context, evidenceId, user);
      await this.writable(tx, context, score.criterionId, user);
      if (!canDelete) throw new ForbiddenException({ code: "INITIAL_EVIDENCE_LOCKED", message: "Không được xóa minh chứng lượt tự chấm trong thời gian bổ sung" });
      await tx.evidence.delete({ where: { id: evidenceId } });
      await tx.evidenceUpload.updateMany({ where: { id: evidenceId }, data: { state: "DELETING" } });
      await this.audit.record({ actorId: user.id, action: "DELETE", entity: "Evidence", entityId: evidenceId, before: { evaluationId: id, criterionId: score.criterionId, kind: evidence.kind, round: evidence.round } }, tx);
    });
    await this.cleanup(evidenceId).catch(() => this.logger.warn("Minh chứng đã xóa, tệp sẽ được dọn lại sau"));
    return { message: "Đã xóa minh chứng" };
  }

  /** Hủy reservation của chính chủ để giải phóng quota ngay khi FE có lỗi hoặc người dùng hủy
   * Cho phép dọn pending sau deadline, tuyệt đối không hủy Evidence đã xác nhận
   */
  async cancel(id: string, uploadId: string, user: CurrentUser) {
    await this.run(id, user, async (tx) => {
      const row = await tx.evidenceUpload.findFirst({ where: { id: uploadId, uploaderId: user.id, criterionScore: { evaluationId: id } } });
      if (!row) throw this.missing();
      if (row.state === "CONFIRMED") throw this.rule("Tệp đã được xác nhận thành minh chứng, không thể hủy phiên tải");
      await tx.evidenceUpload.update({ where: { id: uploadId }, data: { state: "DELETING" } });
    });
    await this.cleanup(uploadId).catch(() => this.logger.warn("Phiên tải đã hủy, tệp sẽ được dọn lại sau"));
    return { message: "Đã hủy phiên tải tệp" };
  }

  /** Dọn object chờ quá hạn/xóa và pending thừa của phiên đã xác nhận, có thể gọi lại sau restart
   * Giữ khóa kỳ/hồ sơ rồi đọc lại state để không đua confirm; chỉ xóa final khi Evidence không tồn tại
   * Lỗi provider rollback việc xóa tombstone, lần sau retry idempotent các object đã mất
   * uploadId giới hạn dọn sau thao tác người dùng, tránh chờ backlog của hồ sơ không liên quan
   * Worker toàn cục chống chạy chồng, tác vụ riêng vẫn có khóa DB để cùng tiến trình khác tuần tự an toàn
   */
  async cleanup(uploadId?: string): Promise<void> {
    if ((!uploadId && this.cleaning) || !this.config.get<boolean>("STORAGE_ENABLED")) return;
    if (!uploadId) this.cleaning = true;
    try {
      const now = await this.state.databaseNow(this.prisma);
      const rows = await this.prisma.evidenceUpload.findMany({ where: { ...(uploadId ? { id: uploadId } : {}), OR: [{ state: "DELETING" }, { state: "PENDING", expiresAt: { lte: now } }, { state: "CONFIRMED", pendingPurged: false }] }, include: { criterionScore: { select: { evaluationId: true, evaluation: { select: { periodId: true } } } } }, take: 100, orderBy: { expiresAt: "asc" } });
      for (const row of rows) {
        try { await this.prisma.$transaction(async (tx) => {
          await lockPeriod(tx, row.criterionScore.evaluation.periodId, "shared");
          await tx.$queryRaw`SELECT id FROM evaluations WHERE id = ${row.criterionScore.evaluationId}::uuid FOR UPDATE`;
          const current = await tx.evidenceUpload.findUnique({ where: { id: row.id } });
          if (!current) return;
          if (current.state === "PENDING" && current.expiresAt > await this.state.databaseNow(tx)) return;
          await this.storage.remove(current.pendingPath);
          const evidence = await tx.evidence.findUnique({ where: { id: row.id } });
          if (!evidence) await this.storage.remove(current.finalPath);
          if (!evidence) await tx.evidenceUpload.delete({ where: { id: row.id } });
          else await tx.evidenceUpload.update({ where: { id: row.id }, data: { pendingPurged: true } });
        }, { timeout: 60000, maxWait: 10000 }); }
        catch { this.logger.warn("Chưa dọn được một tệp chờ, giữ phiên để thử lại sau"); }
      }
    } finally { if (!uploadId) this.cleaning = false; }
  }
}
