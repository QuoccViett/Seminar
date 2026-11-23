import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, Matches } from "class-validator";

/** Nhận hai mốc có múi giờ để xem trước, không tạo yêu cầu bổ sung */
export class PreviewSupplementScheduleDto {
  @ApiProperty({ type: String, format: "date-time", example: "2026-11-20T23:30:00+07:00" })
  @IsDateString({ strict: true }, { message: "Thời gian mở bổ sung không hợp lệ" })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: "Thời gian mở bổ sung phải kèm múi giờ Z hoặc độ lệch UTC" })
  supplementStartAt!: string;

  @ApiProperty({ type: String, format: "date-time", example: "2026-11-22T10:15:00+07:00" })
  @IsDateString({ strict: true }, { message: "Thời hạn bổ sung không hợp lệ" })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: "Thời hạn bổ sung phải kèm múi giờ Z hoặc độ lệch UTC" })
  supplementDeadline!: string;
}
