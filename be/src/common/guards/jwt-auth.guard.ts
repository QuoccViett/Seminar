import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CurrentUser, UserRole } from "../decorators/current-user.js";
import { AUTHORIZED_ROLES } from "../decorators/roles.decorator.js";
import { ERROR_CODES } from "../constants/error-codes.js";

interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user?: CurrentUser;
}

interface AccessTokenPayload {
  sub?: unknown;
  tokenUse?: unknown;
  ver?: unknown;
  exp?: unknown;
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: ERROR_CODES.UNAUTHORIZED,
    message: "Đăng nhập hoặc access token hợp lệ là bắt buộc.",

  });
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /** Xác minh chữ ký và trạng thái tài khoản trước khi kiểm tra quyền đổi mật khẩu
   * Chỉ các handler được đánh dấu rõ mới cho phép phiên bắt buộc đổi mật khẩu tiếp tục
   * Phiên bản thiếu hoặc khác cơ sở dữ liệu bị từ chối để vô hiệu hóa access token cũ
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token, extra] = authorization?.trim().split(/\s+/) ?? [];

    if (scheme?.toLowerCase() !== "bearer" || !token || extra) {
      throw unauthorized();
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw unauthorized();
    }

    if (
      typeof payload.sub !== "string" ||
      payload.tokenUse !== "access" ||
      !Number.isInteger(payload.ver) || typeof payload.exp !== "number"
    ) {
      throw unauthorized();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        unitId: true,
        isActive: true,
        mustChangePassword: true,
        credentialVersion: true,
        unit: { select: { isActive: true } },
      },
    });

    if (!user?.isActive || user.credentialVersion !== payload.ver) {
      throw unauthorized();
    }

    if (user.mustChangePassword && !Reflect.getMetadata("auth:allow-password-change", context.getHandler())) {
      throw new ForbiddenException({ statusCode: 403, code: "PASSWORD_CHANGE_REQUIRED", message: "Bạn phải đổi mật khẩu trước khi tiếp tục." });
    }

    if (user.role === "ADMIN" && user.unitId === null) {
      request.user = { id: user.id, role: "ADMIN", unitId: null };
      return true;
    }

    if (
      user.role === "UNIT" &&
      user.unitId !== null &&
      user.unit?.isActive
    ) {
      request.user = { id: user.id, role: "UNIT", unitId: user.unitId };
      return true;
    }

    throw unauthorized();
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      AUTHORIZED_ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user && requiredRoles.includes(request.user.role)) {
      return true;
    }

    throw new ForbiddenException({
      statusCode: 403,
      code: ERROR_CODES.FORBIDDEN,
      message: "Bạn không có quyền thực hiện thao tác này.",

    });
  }
}
