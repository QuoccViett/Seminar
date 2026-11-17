import { BadRequestException, ForbiddenException, Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AuditService } from "../../common/services/audit.service.js";
import { CredentialDispatchService } from "../notifications/credential-dispatch.service.js";

const BCRYPT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(32).toString("hex"), BCRYPT_ROUNDS);
const COMMON_PASSWORDS = new Set(["123456", "12345678", "123456789", "password1", "password123", "123456a", "qwerty123", "admin123"]);
type SafeUser = { id: string; username: string; fullName: string; role: string; unitId: string | null; mustChangePassword: boolean; credentialVersion: number };
type AuthenticatedUser = { id: string; role: "ADMIN" | "UNIT"; unitId: string | null };

/** Tạo lỗi trường thống nhất, không tiết lộ dữ liệu người dùng đã gửi
 * Đầu vào là tên trường kỹ thuật và lời giải thích tiếng Việt, đầu ra là lỗi HTTP 400
 */
function validationError(field: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code: "VALIDATION_ERROR", message: "Dữ liệu gửi lên không hợp lệ.", details: [{ field, messages: [message] }] });
}
/** Dùng cùng phản hồi cho tài khoản không tồn tại, bị khóa hoặc sai mật khẩu để hạn chế dò tài khoản */
function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({ statusCode: 401, code: "INVALID_CREDENTIALS", message: "Tên đăng nhập hoặc mật khẩu không chính xác." });
}
/** Không phân biệt token không tồn tại, hết hạn và bị thu hồi trong phản hồi gửi khách hàng */
function invalidRefreshToken(): UnauthorizedException {
  return new UnauthorizedException({ statusCode: 401, code: "INVALID_REFRESH_TOKEN", message: "Phiên làm mới không hợp lệ hoặc đã hết hạn.", details: [] });
}
/** Băm token trước khi tìm hoặc lưu để cơ sở dữ liệu không chứa token có thể sử dụng trực tiếp */
function hashRefreshToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
/** Chỉ đưa các trường hồ sơ an toàn ra ngoài, không trả phiên bản xác thực hoặc mật khẩu */
function toSafeUser(user: SafeUser) {
  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role, unitId: user.unitId, mustChangePassword: user.mustChangePassword };
}
/** Kiểm tra token opaque do khách hàng gửi trước khi truy vấn, từ chối chuỗi rỗng */
function requireRefreshToken(body: { refreshToken?: unknown } | null | undefined): string {
  if (typeof body?.refreshToken !== "string" || !body.refreshToken.trim()) throw validationError("refreshToken", "Mã làm mới là bắt buộc.");
  return body.refreshToken;
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(JwtService) private readonly jwtService: JwtService, @Optional() @Inject(ConfigService) private readonly config?: ConfigService, @Optional() @Inject(AuditService) private readonly audit?: AuditService, @Optional() @Inject(CredentialDispatchService) private readonly credentials?: CredentialDispatchService) {}

  /** Chỉ tài khoản đang hoạt động, có vai trò và đơn vị nhất quán mới được cấp phiên */
  private isUsable(user: { role: string; unitId: string | null; isActive: boolean; unit?: { isActive: boolean } | null }): boolean {
    return user.isActive && (user.role === "ADMIN" ? user.unitId === null : user.role === "UNIT" && !!user.unitId && !!user.unit?.isActive);
  }
  /** Đọc hồ sơ và trạng thái đơn vị hiện hành để không tin quyền đã lưu trong token */
  private async findValidUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, fullName: true, role: true, unitId: true, isActive: true, mustChangePassword: true, credentialVersion: true, unit: { select: { id: true, code: true, name: true, unitType: true, isActive: true } } } });
    return user && this.isUsable(user) ? user : null;
  }
  /** Ký access token với phiên bản hiện tại, TTL và thuật toán đã được cấu hình tại module */
  private signAccessToken(user: SafeUser): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id, tokenUse: "access", ver: user.credentialVersion }, { expiresIn: this.accessTtl });
  }
  /** Trả thời hạn access theo cấu hình, mặc định 900 giây khi kiểm thử service độc lập */
  private get accessTtl(): number { return Number(this.config?.get("JWT_ACCESS_TTL_SECONDS") ?? 900); }
  /** Trả thời hạn refresh theo cấu hình, mặc định bảy ngày khi kiểm thử service độc lập */
  private get refreshTtl(): number { return Number(this.config?.get("JWT_REFRESH_TTL_SECONDS") ?? 604800); }

  /** Cấp phiên đăng nhập mới và cập nhật lần đăng nhập trong cùng giao dịch
   * Token ngẫu nhiên 48 byte chỉ trả một lần, cơ sở dữ liệu chỉ lưu bản băm SHA-256
   */
  private async createTokenPair(user: SafeUser & { passwordHash: string }, ip?: string) {
    const now = new Date();
    const refreshToken = randomBytes(48).toString("base64url");
    const accessToken = await this.signAccessToken(user);
    await this.prisma.$transaction(async (tx) => {
      // Khóa và kiểm tra phiên bản cùng hash để không cấp phiên theo mật khẩu vừa bị đặt lại
      const current = await tx.user.updateMany({ where: { id: user.id, credentialVersion: user.credentialVersion, passwordHash: user.passwordHash, isActive: true }, data: { lastLoginAt: now, updatedAt: now } });
      if (current.count !== 1) throw invalidCredentials();
      await tx.refreshToken.create({ data: { id: randomUUID(), userId: user.id, tokenHash: hashRefreshToken(refreshToken), expiresAt: new Date(now.getTime() + this.refreshTtl * 1000), createdAt: now } });
      await this.audit?.record({ actorId: user.id, action: "LOGIN_SUCCESS", entity: "User", entityId: user.id, ip }, tx);
    });
    return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: this.accessTtl, user: toSafeUser(user) };
  }
  /** Xác minh thông tin đăng nhập và cấp phiên, kể cả tài khoản lạ vẫn so bcrypt giả
   * Không phân biệt tài khoản khóa, đơn vị khóa hoặc sai mật khẩu trong phản hồi lỗi
   */
  async login(body: { username?: unknown; password?: unknown } | null | undefined, ip?: string) {
    if (typeof body?.username !== "string" || body.username.trim().length < 3 || body.username.trim().length > 64) throw validationError("username", "Tên đăng nhập phải có từ 3 đến 64 ký tự.");
    if (typeof body.password !== "string" || body.password.length < 1 || body.password.length > 128) throw validationError("password", "Mật khẩu phải có từ 1 đến 128 ký tự.");
    const user = await this.prisma.user.findUnique({ where: { username: body.username.trim() }, select: { id: true, username: true, passwordHash: true, fullName: true, role: true, unitId: true, isActive: true, mustChangePassword: true, credentialVersion: true, unit: { select: { isActive: true } } } });
    const matches = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !matches || !this.isUsable(user)) {
      await this.audit?.record({ actorId: user?.id ?? null, action: "LOGIN_FAILED", entity: "User", entityId: user?.id ?? "unknown", ip });
      throw invalidCredentials();
    }
    return this.createTokenPair(user, ip);
  }
  /** Trả hồ sơ an toàn cùng đơn vị hiện tại sau khi kiểm tra tài khoản vẫn hoạt động */
  async getMe(userId: string) {
    const user = await this.findValidUser(userId);
    if (!user) throw invalidCredentials();
    return { ...toSafeUser(user), unit: user.unit ? { id: user.unit.id, code: user.unit.code, name: user.unit.name, unitType: user.unit.unitType } : null };
  }
  /** Xoay vòng refresh token bằng cập nhật có điều kiện trong giao dịch
   * Nếu token đã dùng hoặc hai yêu cầu tranh chấp, thu hồi tất cả phiên rồi commit trước khi trả lỗi
   * Token hết hạn và token không tồn tại không làm thay đổi phiên khác của người dùng
   */
  async refresh(body: { refreshToken?: unknown } | null | undefined) {
    const token = requireRefreshToken(body);
    const now = new Date();
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(token) }, select: { id: true, userId: true, expiresAt: true, revokedAt: true } });
    if (!stored || stored.expiresAt <= now) throw invalidRefreshToken();
    const user = await this.findValidUser(stored.userId);
    if (!user) throw invalidRefreshToken();
    if (stored.revokedAt) {
      // Thu hồi các phiên còn lại trước khi trả lỗi để giao dịch không bị hoàn tác
      await this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      throw invalidRefreshToken();
    }
    if (user.mustChangePassword) throw new ForbiddenException({ statusCode: 403, code: "PASSWORD_CHANGE_REQUIRED", message: "Bạn phải đổi mật khẩu trước khi tiếp tục." });
    const next = randomBytes(48).toString("base64url");
    const accessToken = await this.signAccessToken(user);
    const rotated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
      if (result.count !== 1) {
        await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
        return false;
      }
      await tx.refreshToken.create({ data: { id: randomUUID(), userId: user.id, tokenHash: hashRefreshToken(next), expiresAt: new Date(now.getTime() + this.refreshTtl * 1000), createdAt: now } });
      return true;
    });
    if (!rotated) throw invalidRefreshToken();
    return { accessToken, refreshToken: next, tokenType: "Bearer", expiresIn: this.accessTtl, user: toSafeUser(user) };
  }
  /** Thu hồi riêng token gửi lên, trả thành công cả khi token đã thu hồi hoặc không tồn tại */
  async logout(body: { refreshToken?: unknown } | null | undefined) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: hashRefreshToken(requireRefreshToken(body)), revokedAt: null }, data: { revokedAt: new Date() } });
    return { success: true };
  }
  /** Đổi mật khẩu và cấp phiên thay thế trong cùng giao dịch để phiên cũ không còn hiệu lực
   * Kiểm tra số ký tự Unicode và số byte UTF-8 riêng vì bcrypt chỉ xét 72 byte đầu
   * So cả hash cũ để ngăn mật khẩu khác chuỗi nhưng tương đương sau khi bcrypt cắt byte
   */
  async changePassword(currentUser: AuthenticatedUser, body: { currentPassword?: unknown; newPassword?: unknown } | null | undefined, ip?: string) {
    if (typeof body?.currentPassword !== "string" || !body.currentPassword) throw validationError("currentPassword", "Mật khẩu hiện tại là bắt buộc.");
    if (typeof body.newPassword !== "string" || [...body.newPassword].length < 8) throw validationError("newPassword", "Mật khẩu mới phải có ít nhất 8 ký tự.");
    const password = body.newPassword;
    if (Buffer.byteLength(password, "utf8") > 72) throw validationError("newPassword", "Mật khẩu mới không được quá 72 byte UTF-8.");
    if (!/\p{L}/u.test(password) || !/[0-9]/u.test(password)) throw validationError("newPassword", "Mật khẩu mới phải có chữ và số.");
    const user = await this.prisma.user.findUnique({ where: { id: currentUser.id }, select: { id: true, username: true, passwordHash: true, fullName: true, role: true, unitId: true, isActive: true, mustChangePassword: true, credentialVersion: true } });
    if (!user || !user.isActive) throw invalidCredentials();
    if (!await bcrypt.compare(body.currentPassword, user.passwordHash)) throw validationError("currentPassword", "Mật khẩu hiện tại không chính xác.");
    if (password.toLocaleLowerCase() === user.username.toLocaleLowerCase() || COMMON_PASSWORDS.has(password.toLocaleLowerCase()) || password === (this.config?.get<string>("INITIAL_ACCOUNT_PASSWORD") ?? "123456") || await bcrypt.compare(password, user.passwordHash)) throw validationError("newPassword", "Mật khẩu mới phải khác tên đăng nhập, mật khẩu cũ và mật khẩu phổ biến.");
    const now = new Date();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const refreshToken = randomBytes(48).toString("base64url");
    const nextUser = { ...user, mustChangePassword: false, credentialVersion: user.credentialVersion + 1 };
    const accessToken = await this.signAccessToken(nextUser);
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash, credentialVersion: user.credentialVersion }, data: { passwordHash, mustChangePassword: false, credentialVersion: { increment: 1 }, passwordChangedAt: now, updatedAt: now } });
      if (changed.count !== 1) throw validationError("currentPassword", "Mật khẩu đã thay đổi, vui lòng thử lại.");
      // Phiên bản mới hủy toàn bộ ciphertext/token mời cũ ngay trong giao dịch đổi mật khẩu
      await this.credentials?.cancelForUser(tx, user.id, now);
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.refreshToken.create({ data: { id: randomUUID(), userId: user.id, tokenHash: hashRefreshToken(refreshToken), expiresAt: new Date(now.getTime() + this.refreshTtl * 1000), createdAt: now } });
      await this.audit?.record({ actorId: user.id, action: "PASSWORD_CHANGED", entity: "User", entityId: user.id, ip }, tx);
      return { ...user, mustChangePassword: false, credentialVersion: user.credentialVersion + 1 };
    });
    return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: this.accessTtl, user: toSafeUser(updated) };
  }
}
