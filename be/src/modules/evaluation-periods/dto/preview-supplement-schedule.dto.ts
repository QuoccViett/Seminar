import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, Matches } from "class-validator";

/** Nhận mốc mở để xem trước lịch bổ sung tạm, chưa ghi vào hồ sơ
 * supplementStartAt phải có offset hoặc Z để quy đổi chính xác ngày Việt Nam
 * Service kiểm cuối tuần và tự tính deadline, không nhận hạn hoặc số giờ từ client
 */
export class PreviewSupplementScheduleDto {
  @ApiProperty({ type: String, format: "date-time", example: "2026-11-20T23:30:00+07:00" })
  @IsDateString({ strict: true }, { message: "Thời gian mở bổ sung không hợp lệ" })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: "Thời gian mở bổ sung phải kèm múi giờ Z hoặc độ lệch UTC" })
  supplementStartAt!: string;
}
