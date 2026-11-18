import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

export const PHASE_TARGETS = ["SELF_EVAL", "FIRST_REVIEW", "SUPPLEMENT", "FINAL_REVIEW", "CLOSED"] as const;
export type PhaseTarget = typeof PHASE_TARGETS[number];

/** Nhận đích chuyển giai đoạn qua lệnh chuyên dụng của Admin
 * phase chỉ là yêu cầu, service vẫn kiểm đồ thị, thời gian và tình trạng hồ sơ
 * Không cho gửi SETUP hoặc dấu thời gian để tránh mở lại kỳ và tự cấp kết quả chốt
 */
export class TransitionPhaseDto {
  @ApiProperty({ enum: PHASE_TARGETS })
  @IsIn(PHASE_TARGETS, { message: "Giai đoạn chuyển đến không hợp lệ" })
  phase!: PhaseTarget;
}
