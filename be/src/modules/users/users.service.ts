import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ERROR_CODES } from "../../common/constants/error-codes.js";
import { AuditService } from "../../common/services/audit.service.js";
import type { CurrentUser } from "../../common/decorators/current-user.js";
import type { CreateUserDto } from "./dto/create-user.dto.js";
import type { UpdateUserDto } from "./dto/update-user.dto.js";

const BCRYPT_ROUNDS = 12;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USER_SELECT = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  phone: true,
  role: true,
  unitId: true,
  isActive: true,
  mustChangePassword: true,
  credentialsSentAt: true,
  lastLoginAt: true,
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

function userNotFound() {
  return new NotFoundException({
    statusCode: 404,
    code: "USER_NOT_FOUND",
    message: "Không tìm thấy tài khoản.",
    details: [],
  });
}

function unitAccountExists() {
  return new ConflictException({
    statusCode: 409,
    code: "UNIT_ACCOUNT_EXISTS",
    message: "Đơn vị đã có tài khoản UNIT.",
    details: [],
  });
}

function userAlreadyExists() {
  return new ConflictException({
    statusCode: 409,
    code: ERROR_CODES.CONFLICT,
    message: "Username, email hoặc đơn vị đã được sử dụng.",
    details: [],
  });
}

function usernameTaken() {
  return new ConflictException({
    statusCode: 409,
    code: ERROR_CODES.USERNAME_TAKEN,
    message: "Tên đăng nhập đã được sử dụng.",
    details: [],
  });
}

function emailTaken() {
  return new ConflictException({
    statusCode: 409,
    code: ERROR_CODES.CONFLICT,
    message: "Email đã được sử dụng.",
    details: [],
  });
}

function selfModification() {
  return new UnprocessableEntityException({
    statusCode: 422,
    code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
    message: "Không thể tự khóa tài khoản hoặc tự hạ quyền chính mình.",
    details: [],
  });
}

/** Báo lỗi khi thao tác sẽ làm hệ thống không còn ADMIN đang hoạt động
 * Mã kỹ thuật ổn định để FE phân biệt với lỗi xác thực hoặc dữ liệu trường
 */
function lastAdmin() {
  return new UnprocessableEntityException({ statusCode: 422, code: "LAST_ADMIN", message: "Phải giữ ít nhất một quản trị viên đang hoạt động.", details: [] });
}

function isUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/** Chuyển tham số phân trang thành số nguyên trong giới hạn để tránh truy vấn quá lớn
 * Thiếu tham số dùng trang 1 và 20 dòng, giá trị sai trả lỗi trường tiếng Việt
 */
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

/** Lọc các thuộc tính có giá trị để DTO chưa được gửi không bị xem là yêu cầu sửa
 * Đầu ra là tên trường phục vụ allowlist theo vai trò
 */
function suppliedKeys(dto: object): string[] {
  return Object.entries(dto)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(ConfigService) private readonly config?: ConfigService,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  /** Liệt kê tài khoản với bộ lọc được xác thực và thứ tự ổn định có ID
   * Chỉ ADMIN được gọi route; kết quả chọn hồ sơ công khai và tên đơn vị để FE hiển thị
   */
  async findAll(query: {
    page?: string;
    pageSize?: string;
    role?: string;
    unitId?: string;
    isActive?: string;
    q?: string;
  }) {
    const { page, pageSize } = parsePagination(query.page, query.pageSize);

    if (query.role && !["ADMIN", "UNIT"].includes(query.role)) {
      throw badRequest("role", "Role chỉ được là ADMIN hoặc UNIT.");
    }

    // Kiểm UUID trước truy vấn để tránh phản hồi lỗi cơ sở dữ liệu cho đầu vào sai
    if (query.unitId && !UUID_PATTERN.test(query.unitId)) {
      throw badRequest("unitId", "unitId phải là UUID hợp lệ.");
    }
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
      ...(query.role ? { role: query.role } : {}),
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(q ? { OR: [{ username: { contains: q, mode: "insensitive" as const } }, { fullName: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          ...USER_SELECT,
          unit: {
            select: { id: true, code: true, name: true, unitType: true },
          },
        },
      }),
    ]);

    return { items, page, pageSize, total };
  }

  /** Trả hồ sơ của bất kỳ tài khoản cho ADMIN hoặc chính mình cho UNIT
   * ID ngoài quyền được trả 404, phản hồi không chứa hash hay phiên bản xác thực
   */
  async findOne(id: string, currentUser: CurrentUser) {
    if (currentUser.role !== "ADMIN" && currentUser.id !== id) {
      throw userNotFound();
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_SELECT,
        unit: {
          select: {
            id: true,
            code: true,
            name: true,
            unitType: true,
            isActive: true,
          },
        },
      },
    });

    if (!user) throw userNotFound();
    return user;
  }

  /** Tạo tài khoản từ thông tin hợp lệ và băm mật khẩu ban đầu lấy từ cấu hình
   * Tài khoản mới luôn phải đổi mật khẩu và mật khẩu tạm chỉ xuất hiện trong phản hồi cấp mới
   */
  async create(dto: CreateUserDto, actorId?: string) {
    const username = dto.username?.trim().toLowerCase();
    const fullName = dto.fullName?.trim();

    if (!username) throw badRequest("username", "username là bắt buộc.");
    if (!fullName) throw badRequest("fullName", "fullName là bắt buộc.");
    if (!["ADMIN", "UNIT"].includes(dto.role)) {
      throw badRequest("role", "Role chỉ được là ADMIN hoặc UNIT.");
    }

    if (dto.role === "ADMIN" && dto.unitId) {
      throw badRequest("unitId", "Tài khoản ADMIN không được gắn đơn vị.");
    }

    const unitId = dto.role === "ADMIN" ? null : (dto.unitId ?? null);

    if (dto.role === "UNIT" && !unitId) {
      throw badRequest("unitId", "Tài khoản UNIT phải có unitId.");
    }

    if (unitId) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: unitId },
        select: { id: true, isActive: true },
      });

      if (!unit || !unit.isActive) {
        throw badRequest("unitId", "Đơn vị không tồn tại hoặc đang bị khóa.");
      }

      const assignedUser = await this.prisma.user.findFirst({
        where: { unitId },
        select: { id: true },
      });

      if (assignedUser) throw unitAccountExists();
    }

    // Kiểm tra trước để trả mã lỗi rõ ràng khi driver không kèm tên cột
    const sameUsername = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (sameUsername) throw usernameTaken();
    const legacyUsername = await this.prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } }, select: { id: true } });
    if (legacyUsername) throw usernameTaken();

    const email = dto.email?.trim().toLowerCase() || null;
    if (email) {
      const sameEmail = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (sameEmail) throw emailTaken();
      const legacyEmail = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
      if (legacyEmail) throw emailTaken();
    }

    // Dùng mật khẩu ban đầu được cấu hình để luồng cấp và đặt lại thống nhất với demo
    const temporaryPassword = this.config?.get<string>("INITIAL_ACCOUNT_PASSWORD") ?? "123456";
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    const now = new Date();

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        if (unitId) {
          // Khóa dòng đơn vị rồi kiểm lại trạng thái để không cấp tài khoản vào đơn vị vừa bị khóa
          await tx.$executeRaw`SELECT 1 FROM "units" WHERE "id" = ${unitId}::uuid FOR UPDATE`;
          const currentUnit = await tx.unit.findUnique({ where: { id: unitId }, select: { isActive: true } });
          if (!currentUnit?.isActive) throw badRequest("unitId", "Đơn vị không tồn tại hoặc đang bị khóa.");
        }
        const created = await tx.user.create({
        data: {
          id: randomUUID(),
          username,
          passwordHash,
          mustChangePassword: true,
          fullName,
          email,
          phone: dto.phone?.trim() || null,
          role: dto.role,
          unitId,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        select: USER_SELECT,
        });
        await this.audit?.record({ actorId: actorId ?? null, action: "USER_CREATED", entity: "User", entityId: created.id, after: created }, tx);
        return created;
      });

      // Mật khẩu tạm chỉ hiển thị đúng một lần, không lưu dạng rõ
      return { ...user, credentialsSentAt: null, temporaryPassword };
    } catch (error) {
      if (isUniqueError(error)) throw userAlreadyExists();
      throw error;
    }
  }

  /** Sửa hồ sơ theo allowlist của vai trò, chặn hạ ADMIN cuối cùng dưới khóa giao dịch
   * Đổi vai trò hoặc đơn vị tăng phiên bản và thu hồi phiên cũ để quyền mới có hiệu lực ngay
   */
  async update(id: string, currentUser: CurrentUser, dto: UpdateUserDto) {
    const isAdmin = currentUser.role === "ADMIN";

    if (!isAdmin && currentUser.id !== id) throw userNotFound();

    const allowedFields = isAdmin
      ? ["fullName", "email", "phone", "role", "unitId"]
      : ["fullName", "email", "phone"];

    const supplied = suppliedKeys(dto);

    if (
      !isAdmin &&
      supplied.some((field) => ["role", "unitId", "isActive"].includes(field))
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Bạn không được tự thay đổi quyền hoặc đơn vị",
        details: [],
      });
    }

    if (
      supplied.length === 0 ||
      supplied.some((field) => !allowedFields.includes(field))
    ) {
      throw badRequest("body", "Không có dữ liệu hợp lệ để cập nhật.");
    }

    if (dto.fullName !== undefined && !dto.fullName.trim()) {
      throw badRequest("fullName", "fullName không được để trống.");
    }

    // Tự hạ quyền bị chặn trước khi chạm cơ sở dữ liệu để phiên hiện tại không mất quyền
    if (
      isAdmin &&
      currentUser.id === id &&
      ((dto.role !== undefined && dto.role !== "ADMIN") || dto.unitId)
    ) {
      throw selfModification();
    }

    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, unitId: true },
    });

    if (!existing) throw userNotFound();

    const data: {
      fullName?: string;
      email?: string | null;
      phone?: string | null;
      role?: string;
      unitId?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.email !== undefined) {
      const email = dto.email?.trim().toLowerCase() || null;
      if (email) {
        const sameEmail = await this.prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (sameEmail && sameEmail.id !== id) throw emailTaken();
        const legacyEmail = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, NOT: { id } }, select: { id: true } });
        if (legacyEmail) throw emailTaken();
      }
      data.email = email;
    }
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;

    if (isAdmin) {
      // Chỉ kiểm tra vai trò và đơn vị khi có yêu cầu đổi để vẫn sửa được hồ sơ đơn vị khóa
      if (dto.role !== undefined || dto.unitId !== undefined) {
        const nextRole = dto.role ?? existing.role;
        let nextUnitId =
          dto.unitId !== undefined ? dto.unitId : existing.unitId;

        if (nextRole === "ADMIN") {
          if (dto.unitId) {
            throw badRequest("unitId", "Tài khoản ADMIN không được gắn đơn vị.");
          }
          nextUnitId = null;
        } else if (nextRole === "UNIT") {
          if (!nextUnitId) {
            throw badRequest("unitId", "Tài khoản UNIT phải có unitId.");
          }

          const unit = await this.prisma.unit.findUnique({
            where: { id: nextUnitId },
            select: { id: true, isActive: true },
          });

          if (!unit || !unit.isActive) {
            throw badRequest("unitId", "Đơn vị không tồn tại hoặc đang bị khóa.");
          }

          const assigned = await this.prisma.user.findFirst({
            where: { unitId: nextUnitId, NOT: { id } },
            select: { id: true },
          });

          if (assigned) throw unitAccountExists();
        } else {
          throw badRequest("role", "Role chỉ được là ADMIN hoặc UNIT.");
        }

        data.role = nextRole;
        data.unitId = nextUnitId;
      }
    }

    // Trạng thái chỉ đi qua route riêng để cùng lúc thu hồi phiên và ghi audit
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "users" WHERE "id" = ${id}::uuid FOR UPDATE`;
        if (dto.role !== undefined || dto.unitId !== undefined) {
          // Mọi thay đổi vai trò cùng xếp hàng để hai request không thể cùng hạ ADMIN cuối
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(417004)`;
        }
        const before = await tx.user.findUnique({ where: { id }, select: USER_SELECT });
        if (!before) throw userNotFound();
        if ((dto.role !== undefined || dto.unitId !== undefined) && (before.role !== existing.role || before.unitId !== existing.unitId)) {
          throw new ConflictException({ statusCode: 409, code: ERROR_CODES.CONFLICT, message: "Tài khoản đã thay đổi. Vui lòng tải lại trước khi sửa quyền.", details: [] });
        }
        if (before.role === "ADMIN" && data.role === "UNIT" && before.isActive) {
          const activeAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
          if (activeAdmins <= 1) throw lastAdmin();
        }
        const securityChanged = data.role !== undefined && data.role !== before.role || data.unitId !== undefined && data.unitId !== before.unitId;
        const updated = await tx.user.update({
          where: { id }, data: { ...data, ...(securityChanged ? { credentialVersion: { increment: 1 } } : {}) }, select: USER_SELECT,
        });
        if (securityChanged) {
          await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: data.updatedAt } });
          await tx.webPushSubscription.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: data.updatedAt } });
        }
        await this.audit?.record({ actorId: currentUser.id, action: "USER_UPDATED", entity: "User", entityId: id, before, after: updated }, tx);
        return updated;
      });
    } catch (error) {
      if (isUniqueError(error)) throw userAlreadyExists();
      throw error;
    }
  }

  /** Đặt lại mật khẩu về giá trị cấu hình, thu hồi refresh và tăng phiên bản access trong giao dịch
   * Tài khoản không tồn tại trả lỗi, tài khoản thành công phải đổi mật khẩu khi đăng nhập lại
   */
  async resetPassword(id: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!user) throw userNotFound();

    // Dùng mật khẩu ban đầu được cấu hình để luồng cấp và đặt lại thống nhất với demo
    const temporaryPassword = this.config?.get<string>("INITIAL_ACCOUNT_PASSWORD") ?? "123456";
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "users" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const before = await tx.user.findUnique({ where: { id }, select: USER_SELECT });
      if (!before) throw userNotFound();
      const updated = await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          credentialsSentAt: null,
          // Tăng phiên bản để access token phát trước khi đặt lại bị từ chối ngay
          credentialVersion: { increment: 1 },
          passwordChangedAt: now,
          updatedAt: now,
        },
        select: USER_SELECT,
      });

      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.webPushSubscription.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await this.audit?.record({ actorId: actorId ?? null, action: "USER_PASSWORD_RESET", entity: "User", entityId: id, before, after: updated }, tx);
    });

    return { userId: id, temporaryPassword, mustChangePassword: true, credentialsSentAt: null };
  }

  /** Đổi trạng thái tài khoản dưới khóa chung cho ADMIN và thu hồi toàn bộ phiên khi khóa
   * Khóa subscription sau khi khóa tài khoản; mở lại không khôi phục phiên hay thiết bị cũ
   */
  async updateStatus(id: string, isActive: boolean, currentUser: CurrentUser) {
    if (typeof isActive !== "boolean") {
      throw badRequest("isActive", "isActive phải là true hoặc false.");
    }

    if (currentUser.id === id && !isActive) throw selfModification();

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!user) throw userNotFound();

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "users" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!isActive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(417004)`;
      const before = await tx.user.findUnique({ where: { id }, select: USER_SELECT });
      if (!before) throw userNotFound();
      if (!isActive && before.role === "ADMIN" && before.isActive) {
        const activeAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
        if (activeAdmins <= 1) throw lastAdmin();
      }
      const updated = await tx.user.update({
        where: { id },
        data: { isActive, updatedAt: now, ...(!isActive && before.isActive ? { credentialVersion: { increment: 1 } } : {}) },
        select: {
          id: true,
          username: true,
          fullName: true,
          role: true,
          unitId: true,
          isActive: true,
          updatedAt: true,
        },
      });

      if (!isActive) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.webPushSubscription.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      }
      await this.audit?.record({ actorId: currentUser.id, action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED", entity: "User", entityId: id, before, after: updated }, tx);
      return updated;
    });
  }
}
