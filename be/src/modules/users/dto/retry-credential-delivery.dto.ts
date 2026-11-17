import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

/** DTO cho yêu cầu thử lại một kênh gửi credential đã thất bại
 * Client chỉ chọn channel; tài khoản và actor được lấy từ route và access token để chặn gửi chéo
 * Email/Web Push có worker riêng, còn ZNS bị loại vì chưa kích hoạt provider và không được xếp hàng
 */
export class RetryCredentialDeliveryDto {
  /** Định danh kênh kỹ thuật được phép để service tìm đúng delivery trong dispatch hiện hành
   * Giá trị đầu vào chỉ là EMAIL hoặc WEB_PUSH; phản hồi xác nhận PENDING không khẳng định đã gửi
   */
  @ApiProperty({ enum: ["EMAIL", "WEB_PUSH"], example: "EMAIL" })
  @IsIn(["EMAIL", "WEB_PUSH"], { message: "channel chỉ được là EMAIL hoặc WEB_PUSH." })
  channel!: "EMAIL" | "WEB_PUSH";
}
