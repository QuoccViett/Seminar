import { ApiProperty } from "@nestjs/swagger";
import { IsJWT } from "class-validator";

/** Nhận chữ ký tải ngắn hạn bắt buộc, chỉ kiểm hình thức ở pipe
 * Service kiểm chữ ký, hạn, mục đích và người đọc sau khi guard đã xác thực quyền ADMIN
 */
export class ReportDownloadQueryDto {
  @ApiProperty({ description: "Chữ ký tải có hạn lấy từ metadata mới nhất" })
  @IsJWT({ message: "Cần cung cấp chữ ký tải báo cáo hợp lệ" })
  token!: string;
}
