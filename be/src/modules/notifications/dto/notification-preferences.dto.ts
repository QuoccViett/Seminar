import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional } from "class-validator";

/** Nhận đúng ba tùy chọn kênh ngoài hộp thư; SYSTEM không thể tắt và trường lạ bị global pipe từ chối
 * Mỗi trường vắng mặt được giữ nguyên, còn giá trị có mặt phải là boolean JSON thật
 */
export class NotificationPreferencesDto {
  /** Bật hoặc tắt yêu cầu gửi qua thiết bị đã đăng ký */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean({ message: "WEB_PUSH phải là giá trị đúng hoặc sai." })
  WEB_PUSH?: boolean;

  /** Bật hoặc tắt yêu cầu gửi qua địa chỉ email của tài khoản */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean({ message: "EMAIL phải là giá trị đúng hoặc sai." })
  EMAIL?: boolean;

  /** Chỉ cho bật ZNS khi cấu hình hệ thống đã kích hoạt dịch vụ */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean({ message: "ZALO_ZNS phải là giá trị đúng hoặc sai." })
  ZALO_ZNS?: boolean;
}
