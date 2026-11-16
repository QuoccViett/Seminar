import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

/** Kiểm tra kiểu và độ dài sơ bộ trước khi service áp dụng chính sách mật khẩu và giới hạn byte
 * Mật khẩu hiện tại vẫn cho phép giá trị demo ngắn để người dùng có thể đổi lần đầu
 */
export class ChangePasswordDto {
  @ApiProperty({
    type: String,
    example: "current-password",
    description: "Mật khẩu hiện tại",
  })
  @IsString({ message: "Mật khẩu hiện tại phải là chuỗi." })
  @IsNotEmpty({ message: "Mật khẩu hiện tại là bắt buộc." })
  currentPassword!: string;

  @ApiProperty({
    type: String,
    example: "new-password-123",
    description: "Mật khẩu mới tối thiểu 8 ký tự và tối đa 72 byte UTF-8",
    minLength: 8,
    maxLength: 72,
  })
  @IsString({ message: "Mật khẩu mới phải là chuỗi." })
  @MinLength(8, { message: "Mật khẩu mới phải có ít nhất 8 ký tự." })
  @MaxLength(72, { message: "Mật khẩu mới không được quá 72 ký tự." })
  newPassword!: string;
}