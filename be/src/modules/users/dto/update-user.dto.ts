import { ApiPropertyOptional } from "@nestjs/swagger";
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
} from "class-validator";

/** Chỉ nhận các trường sửa hồ sơ, trạng thái khóa dùng route riêng
 * Service giới hạn role và unitId theo vai trò người gọi sau khi DTO xác thực kiểu dữ liệu
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString({ message: "fullName phải là chuỗi." })
  @IsNotEmpty({ message: "fullName không được để trống." })
  fullName?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsOptional()
  @IsEmail({}, { message: "email không hợp lệ." })
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsOptional()
  @IsString({ message: "phone phải là chuỗi." })
  @MaxLength(20, { message: "phone tối đa 20 ký tự." })
  @Matches(/^\+?[0-9]{9,15}$/, { message: "phone phải có 9 đến 15 chữ số và có thể bắt đầu bằng dấu +." })
  phone?: string | null;

  @ApiPropertyOptional({ type: String, enum: ["ADMIN", "UNIT"], description: "Chỉ ADMIN được đổi." })
  @IsOptional()
  @IsIn(["ADMIN", "UNIT"], { message: "role chỉ được là ADMIN hoặc UNIT." })
  role?: "ADMIN" | "UNIT";

  @ApiPropertyOptional({ type: String, nullable: true, description: "Chỉ ADMIN được đổi." })
  @IsOptional()
  @IsUUID("all", { message: "unitId phải là UUID hợp lệ." })
  unitId?: string | null;

}
