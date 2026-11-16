import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export type UserRole = "ADMIN" | "UNIT";

export interface CurrentUser {
  id: string;
  role: UserRole;
  unitId: string | null;
}

interface AuthenticatedRequest {
  user?: CurrentUser;
}

/** Lấy người dùng đã được guard xác thực để controller không đọc token trực tiếp
 * Nếu thiếu guard thì báo lỗi cấu hình thay vì trả dữ liệu người dùng không đáng tin
 */
export const GetCurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new Error("Tuyến này cần JwtAuthGuard trước khi lấy người dùng hiện tại");
    }
    return request.user;
  },
);
