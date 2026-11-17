import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  MinLength,
} from "class-validator";

/** Nhận thông tin cấp tài khoản, không nhận mật khẩu hoặc trạng thái gửi từ client
 * ADMIN cần không có đơn vị, UNIT phải có unitId; service kiểm quan hệ này với DB
 */
export class CreateUserDto {
  /** Tên đăng nhập kỹ thuật, chuẩn hóa chữ thường trước khi lưu */
  @ApiProperty({ type: String, example: "coso35" })
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsString({ message: "username phải là chuỗi." })
  @IsNotEmpty({ message: "username là bắt buộc." })
  @MinLength(3, { message: "username phải có ít nhất 3 ký tự." })
  @MaxLength(64, { message: "username tối đa 64 ký tự." })
  @Matches(/^[A-Za-z0-9._-]+$/, { message: "username chỉ được chứa chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang." })
  username!: string;

  @ApiProperty({ type: String, example: "Cơ sở Đoàn demo 35" })
  @IsString({ message: "fullName phải là chuỗi." })
  @IsNotEmpty({ message: "fullName là bắt buộc." })
  fullName!: string;

  @ApiProperty({ type: String, enum: ["ADMIN", "UNIT"], example: "UNIT" })
  @IsIn(["ADMIN", "UNIT"], { message: "role chỉ được là ADMIN hoặc UNIT." })
  role!: "ADMIN" | "UNIT";

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Bắt buộc với role UNIT (lấy id từ GET /units); bỏ trống với ADMIN.",
  })
  @IsOptional()
  @IsUUID("all", { message: "unitId phải là UUID hợp lệ." })
  unitId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: "coso35@example.com" })
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsOptional()
  @IsEmail({}, { message: "email không hợp lệ." })
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: "0901234567" })
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsOptional()
  @IsString({ message: "phone phải là chuỗi." })
  @MaxLength(20, { message: "phone tối đa 20 ký tự." })
  @Matches(/^\+?[0-9]{9,15}$/, { message: "phone phải có 9 đến 15 chữ số và có thể bắt đầu bằng dấu +." })
  phone?: string | null;
}
