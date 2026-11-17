import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail } from "class-validator";

/** Admin nhập lại địa chỉ đã kiểm tra với người nhận để mở khóa việc gửi credential
 * Service còn so với email hiện tại và bản snapshot mã hóa trước khi cho worker lấy việc
 */
export class ConfirmCredentialEmailDto {
  @ApiProperty({ example: "nguoinhan@example.com" })
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsEmail({}, { message: "Email xác nhận không hợp lệ." })
  email!: string;
}
