import { BadRequestException, Injectable } from "@nestjs/common";
import { ClockService } from "./clock.service.js";
import { ERROR_CODES } from "../constants/error-codes.js";

export type SelfEvaluationWindow = {
  publishedAt: Date | null;
  selfEvalStart: Date | null;
  selfEvalDeadline: Date | null;
  phase: string;
};

/** Kiểm cặp mốc Admin chọn, giữ mọi ngày giờ và không tự tính lại hạn đã thông báo */
export function validateSupplementSchedule(start: Date, deadline: Date): Date {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(deadline.getTime()) || start >= deadline) {
    throw new BadRequestException({ code: ERROR_CODES.BUSINESS_RULE_VIOLATION, message: "Thời gian mở bổ sung phải hợp lệ và sớm hơn thời hạn kết thúc" });
  }
  return new Date(deadline);
}

@Injectable()
export class DeadlineCalculator {
  constructor(private readonly clock: ClockService) {}

  /** Trả bản sao hạn tự chấm đã cấu hình, giữ null khi nháp chưa có lịch
   * Không đổi ngày cuối tuần hoặc cộng giờ vì Admin được chọn mọi ngày giờ
   */
  selfEvaluationDeadline(configuredDeadline: Date | null): Date | null {
    return configuredDeadline ? new Date(configuredDeadline) : null;
  }

  /** Giữ hạn được Admin chọn sau khi kiểm cặp mốc tăng dần */
  supplementDeadline(start: Date, deadline: Date): Date {
    return validateSupplementSchedule(start, deadline);
  }

  /** So sánh hạn loại trừ với thời gian server hoặc clock kiểm thử được truyền vào
   * Hạn rỗng chưa được coi là hết hạn, đúng mốc deadline đã phải khóa
   */
  isExpired(deadline: Date | null, now: Date = this.clock.now()): boolean {
    return deadline !== null && now.getTime() >= deadline.getTime();
  }

  /** Tính quyền INITIAL từ trạng thái hồ sơ, giai đoạn và cửa sổ đã công bố
   * SETUP được cho phép đúng giờ khi job mở trễ, SELF_EVAL phải còn trong cửa sổ
   * Các giai đoạn review/đóng luôn từ chối dù lịch bị sửa ngoài API
   * Consumer ghi phải gọi lại sau khi lấy khóa và ngay trước khi lưu
   */
  canSelfEvaluate(
    window: SelfEvaluationWindow,
    evaluationStatus: string,
    now: Date = this.clock.now(),
  ): boolean {
    return window.publishedAt !== null
      && window.selfEvalStart !== null
      && window.selfEvalDeadline !== null
      && evaluationStatus === "DRAFT"
      && ["SETUP", "SELF_EVAL"].includes(window.phase)
      && now.getTime() >= window.selfEvalStart.getTime()
      && now.getTime() < window.selfEvalDeadline.getTime();
  }
}
