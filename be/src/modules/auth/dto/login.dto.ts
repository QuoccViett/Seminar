import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

/** Kiểm tra giới hạn tên đăng nhập và mật khẩu trước khi xử lý xác thực
 * Giới hạn giảm tải đầu vào bất thường nhưng vẫn nhận mật khẩu ban đầu của tài khoản demo
 */
export class LoginDto {
  @ApiProperty({
    type: String,
    example: "admin",
    description: "Tên đăng nhập",
  })
  @IsString({ message: "Tên đăng nhập phải là chuỗi." })
  @IsNotEmpty({ message: "Tên đăng nhập là bắt buộc." })
  @MinLength(3, { message: "Tên đăng nhập phải có ít nhất 3 ký tự." })
  @MaxLength(64, { message: "Tên đăng nhập không được quá 64 ký tự." })
  username!: string;

  @ApiProperty({
    type: String,
    example: "your-password",
    description: "Mật khẩu",
  })
  @IsString({ message: "Mật khẩu phải là chuỗi." })
  @IsNotEmpty({ message: "Mật khẩu là bắt buộc." })
  @MaxLength(128, { message: "Mật khẩu không được quá 128 ký tự." })
  password!: string;
}