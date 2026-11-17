import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ERROR_CODES } from "../../common/constants/error-codes.js";
import { AuditService } from "../../common/services/audit.service.js";
import { UNIT_TYPES, UNIT_TYPE_MESSAGE } from "./unit-types.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import type { CreateUnitDto } from "./dto/create-unit.dto.js";
import type { UpdateUnitDto } from "./dto/update-unit.dto.js";

const UNIT_SELECT = {
  id: true,
  code: true,
  name: true,
  unitType: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function badRequest(field: string, message: string) {
  return new BadRequestException({
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: "Dữ liệu gửi lên không hợp lệ.",
    details: [{ field, messages: [message] }],
  });
}

function notFound() {
  return new NotFoundException({
    statusCode: 404,
    code: "UNIT_NOT_FOUND",
    message: "Không tìm thấy đơn vị.",
    details: [],
  });
}

function codeTaken() {
  return new ConflictException({
    statusCode: 409,
    code: ERROR_CODES.UNIT_CODE_TAKEN,
    message: "Mã đơn vị đã tồn tại.",
    details: [],
  });
}

function isUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function parsePagination(pageValue?: string, sizeValue?: string) {
  const page = pageValue === undefined ? 1 : Number(pageValue);
  const pageSize = sizeValue === undefined ? 20 : Number(sizeValue);

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw badRequest("pagination", "page phải từ 1; pageSize từ 1 đến 100.");
  }

  return { page, pageSize };
}

/** Kiểm tra loại đơn vị trước khi chạm ràng buộc SQL để trả lỗi trường bằng tiếng Việt
 * Giá trị rỗng biểu thị loại chưa được gán; giá trị khác phải khớp đúng CHECK của PostgreSQL
 */
function assertUnitType(value: string | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!(UNIT_TYPES as readonly string[]).includes(value)) {
    throw badRequest("unitType", UNIT_TYPE_MESSAGE);
  }
}

/** Lấy các trường thật sự được gửi để DTO có thuộc tính undefined không bị xem là yêu cầu sửa
 * Đầu vào là DTO đã qua validation, đầu ra là danh sách khóa dùng để áp allowlist
 */
function suppliedKeys(dto: object): string[] {
  return Object.entries(dto)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

@Injectable()
export class UnitsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  /** Liệt kê đơn vị theo quyền và bộ lọc, đồng thời phân trang bằng thứ tự có ID phân giải trùng
   * UNIT chỉ nhận đơn vị của mình; ADMIN có thể tìm mã hoặc tên và lọc trạng thái hay loại
   */
  async findAll(
    currentUser: CurrentUser,
    query: {
      page?: string;
      pageSize?: string;
      unitType?: string;
      isActive?: string;
      q?: string;
    },
  ) {
    if (currentUser.role === "UNIT") {
      if (!currentUser.unitId) throw notFound();
      const unit = await this.prisma.unit.findUnique({
        where: { id: currentUser.unitId },
        select: UNIT_SELECT,
      });
      if (!unit) throw notFound();
      return { items: [unit], page: 1, pageSize: 1, total: 1 };
    }

    const { page, pageSize } = parsePagination(query.page, query.pageSize);
    assertUnitType(query.unitType || undefined);
    const q = query.q?.trim();
    if (q && q.length > 100) throw badRequest("q", "Từ khóa tìm kiếm tối đa 100 ký tự.");

    let isActive: boolean | undefined;
    if (query.isActive !== undefined) {
      if (!["true", "false"].includes(query.isActive)) {
        throw badRequest("isActive", "isActive chỉ được là true hoặc false.");
      }
      isActive = query.isActive === "true";
    }

    const where = {
      ...(query.unitType ? { unitType: query.unitType } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.unit.count({ where }),
      this.prisma.unit.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        select: UNIT_SELECT,
      }),
    ]);

    return { items, page, pageSize, total };
  }

  /** Trả chi tiết đơn vị khi người gọi là ADMIN hoặc UNIT của chính đơn vị đó
   * Trả 404 cho đơn vị khác để không tiết lộ sự tồn tại của dữ liệu ngoài quyền
   */
  async findOne(id: string, currentUser: CurrentUser) {
    if (currentUser.role === "UNIT" && currentUser.unitId !== id) {
      throw notFound();
    }

    const unit = await this.prisma.unit.findUnique({
      where: { id },
      select: UNIT_SELECT,
    });

    if (!unit) throw notFound();
    return unit;
  }

  /** Tạo đơn vị đã chuẩn hóa và ghi audit trong cùng giao dịch
   * Trùng mã kể cả khi hai request chạy đồng thời được ánh xạ thành lỗi 409 an toàn
   */
  async create(dto: CreateUnitDto, actorId?: string) {
    const code = dto.code?.trim();
    const name = dto.name?.trim();

    if (!code) throw badRequest("code", "code là bắt buộc.");
    if (!name) throw badRequest("name", "name là bắt buộc.");

    if (
      dto.sortOrder !== undefined &&
      (!Number.isInteger(dto.sortOrder) || dto.sortOrder < 0)
    ) {
      throw badRequest("sortOrder", "sortOrder phải là số nguyên không âm.");
    }

    const duplicate = await this.prisma.unit.findUnique({
      where: { code },
      select: { id: true },
    });
    if (duplicate) throw codeTaken();

    const unitType = dto.unitType?.trim() || null;
    assertUnitType(unitType);

    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.unit.create({
        data: {
          id: randomUUID(),
          code,
          name,
          unitType,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        },
        select: UNIT_SELECT,
        });
        await this.audit?.record({ actorId: actorId ?? null, action: "UNIT_CREATED", entity: "Unit", entityId: created.id, after: created }, tx);
        return created;
      });
    } catch (error) {
      if (isUniqueError(error)) throw codeTaken();
      throw error;
    }
  }

  /** Sửa các trường đơn vị được phép và lưu snapshot trước/sau vào audit cùng giao dịch
   * Khóa đơn vị chỉ đổi cờ hoạt động, giữ nguyên hồ sơ và các quan hệ lịch sử
   */
  async update(id: string, dto: UpdateUnitDto, actorId?: string) {
    const allowedFields = ["code", "name", "unitType", "sortOrder", "isActive"];
    const fields = suppliedKeys(dto);

    if (
      fields.length === 0 ||
      fields.some((field) => !allowedFields.includes(field))
    ) {
      throw badRequest("body", "Không có dữ liệu hợp lệ để cập nhật.");
    }

    if (dto.code !== undefined && !dto.code.trim()) {
      throw badRequest("code", "code không được để trống.");
    }
    if (dto.name !== undefined && !dto.name.trim()) {
      throw badRequest("name", "name không được để trống.");
    }
    if (
      dto.sortOrder !== undefined &&
      (!Number.isInteger(dto.sortOrder) || dto.sortOrder < 0)
    ) {
      throw badRequest("sortOrder", "sortOrder phải là số nguyên không âm.");
    }

    const existing = await this.prisma.unit.findUnique({
      where: { id },
      select: UNIT_SELECT,
    });
    if (!existing) throw notFound();

    if (dto.code !== undefined) {
      const duplicate = await this.prisma.unit.findUnique({
        where: { code: dto.code.trim() },
        select: { id: true },
      });
      if (duplicate && duplicate.id !== id) throw codeTaken();
    }

    const data: {
      code?: string;
      name?: string;
      unitType?: string | null;
      sortOrder?: number;
      isActive?: boolean;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (dto.code !== undefined) data.code = dto.code.trim();
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.unitType !== undefined) {
      const unitType = dto.unitType?.trim() || null;
      assertUnitType(unitType);
      data.unitType = unitType;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "units" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const before = await tx.unit.findUnique({ where: { id }, select: UNIT_SELECT });
        if (!before) throw notFound();
        const updated = await tx.unit.update({
        where: { id },
        data,
        select: UNIT_SELECT,
        });
        if (dto.isActive === false && before.isActive) {
          // Tăng phiên bản và thu hồi thiết bị của tài khoản UNIT để mở lại đơn vị không hồi sinh phiên cũ
          const account = await tx.user.findFirst({ where: { unitId: id }, select: { id: true } });
          if (account) {
            await tx.user.update({ where: { id: account.id }, data: { credentialVersion: { increment: 1 }, updatedAt: data.updatedAt } });
            await tx.refreshToken.updateMany({ where: { userId: account.id, revokedAt: null }, data: { revokedAt: data.updatedAt } });
            await tx.webPushSubscription.updateMany({ where: { userId: account.id, revokedAt: null }, data: { revokedAt: data.updatedAt } });
          }
        }
        await this.audit?.record({ actorId: actorId ?? null, action: "UNIT_UPDATED", entity: "Unit", entityId: id, before, after: updated }, tx);
        return updated;
      });
    } catch (error) {
      if (isUniqueError(error)) throw codeTaken();
      throw error;
    }
  }

  /** Liệt kê tài khoản thuộc đơn vị theo quyền đọc đơn vị, chỉ chọn dữ liệu hồ sơ an toàn
   * Đơn vị không tồn tại hoặc khác đơn vị của UNIT đều nhận 404
   */
  async findUsers(id: string, currentUser: CurrentUser) {
    if (currentUser.role === "UNIT" && currentUser.unitId !== id) {
      throw notFound();
    }

    const unit = await this.prisma.unit.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!unit) throw notFound();

    const items = await this.prisma.user.findMany({
      where: { unitId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        unitId: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
      },
    });

    return { items, total: items.length };
  }
}
