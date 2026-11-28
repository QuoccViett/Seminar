import { SetMetadata } from "@nestjs/common";

export const REQUIRE_FRESH_USER = "auth:require-fresh-user";

/** Đọc quyền/trạng thái user từ DB trên mỗi request cấp hoặc tải dữ liệu private. */
export const RequireFreshUser = () => SetMetadata(REQUIRE_FRESH_USER, true);
