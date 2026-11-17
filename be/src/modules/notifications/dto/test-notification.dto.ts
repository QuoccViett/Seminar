import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

/** Chọn kênh kiểm thử cho chính tài khoản hiện tại, không cho client chỉ định người nhận hoặc nội dung bí mật
 * SYSTEM chỉ tạo hộp thư; kênh ngoài tạo delivery để worker xử lý sau commit
 */
export class TestNotificationDto {
  /** Giá trị phải thuộc các kênh chính thức, Telegram cũ không được chấp nhận */
  @ApiProperty({ enum: ["SYSTEM", "WEB_PUSH", "EMAIL", "ZALO_ZNS"] })
  @IsIn(["SYSTEM", "WEB_PUSH", "EMAIL", "ZALO_ZNS"], { message: "channel phải là SYSTEM, WEB_PUSH, EMAIL hoặc ZALO_ZNS." })
  channel!: "SYSTEM" | "WEB_PUSH" | "EMAIL" | "ZALO_ZNS";
}
