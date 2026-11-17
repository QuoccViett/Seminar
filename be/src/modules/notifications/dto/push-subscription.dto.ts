import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateNested } from "class-validator";

/** Chỉ nhận hai khóa mã hóa do PushManager tạo, không nhận userId do trình duyệt tự khai báo
 * Base64url được giới hạn độ dài để tránh lưu dữ liệu lớn hoặc ký tự không thuộc giao ước Web Push
 */
export class PushKeysDto {
  @ApiProperty()
  @IsString({ message: "Khóa p256dh phải là chuỗi." })
  @Matches(/^[A-Za-z0-9_-]+$/, { message: "Khóa p256dh không đúng định dạng." })
  @MinLength(40, { message: "Khóa p256dh quá ngắn." })
  @MaxLength(256, { message: "Khóa p256dh quá dài." })
  p256dh!: string;

  @ApiProperty()
  @IsString({ message: "Khóa auth phải là chuỗi." })
  @Matches(/^[A-Za-z0-9_-]+$/, { message: "Khóa auth không đúng định dạng." })
  @MinLength(16, { message: "Khóa auth quá ngắn." })
  @MaxLength(256, { message: "Khóa auth quá dài." })
  auth!: string;
}

/** Mô tả thiết bị được trình duyệt đăng ký với PushManager
 * Endpoint HTTPS còn được service kiểm tra host cho phép để chặn gửi request tới máy nội bộ
 */
export class PushSubscriptionDto {
  @ApiProperty()
  @IsUrl({ require_protocol: true }, { message: "Endpoint thông báo đẩy không hợp lệ." })
  @MaxLength(2048, { message: "Endpoint thông báo đẩy quá dài." })
  endpoint!: string;

  @ApiProperty({ type: PushKeysDto })
  @IsObject({ message: "Khóa thiết bị không hợp lệ." })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt({ message: "Thời điểm hết hạn thiết bị phải là số nguyên." })
  expirationTime?: number | null;
}

/** Token mời chỉ dùng cho đăng ký thiết bị, không phải access token nghiệp vụ */
export class OnboardingTokenDto {
  @ApiProperty()
  @IsString({ message: "Mã mời phải là chuỗi." })
  @Matches(/^[A-Za-z0-9_-]{64}$/, { message: "Mã mời không hợp lệ." })
  token!: string;
}

/** Ghép token mời với subscription trong một lần dùng nguyên tử */
export class OnboardingSubscriptionDto extends OnboardingTokenDto {
  @ApiProperty({ type: PushSubscriptionDto })
  @ValidateNested()
  @Type(() => PushSubscriptionDto)
  subscription!: PushSubscriptionDto;
}

/** Chỉ thu hồi endpoint của chính phiên đang đăng nhập */
export class RevokePushSubscriptionDto {
  @ApiProperty()
  @IsString({ message: "Endpoint phải là chuỗi." })
  @MaxLength(2048, { message: "Endpoint quá dài." })
  endpoint!: string;
}
