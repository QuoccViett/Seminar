import { BadRequestException, Injectable } from "@nestjs/common";
import { ClockService } from "./clock.service.js";
import { ERROR_CODES } from "../constants/error-codes.js";

export type SelfEvaluationWindow = {
  publishedAt: Date | null;
  selfEvalStart: Date | null;
  selfEvalDeadline: Date | null;
  phase: string;
};

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

@Injectable()
export class DeadlineCalculator {
  constructor(private readonly clock: ClockService) {}

  /** Trả bản sao hạn tự chấm đã cấu hình, giữ null khi nháp chưa có lịch
   * Không đổi ngày cuối tuần hoặc cộng giờ vì Admin được chọn mọi ngày giờ
   */
  selfEvaluationDeadline(configuredDeadline: Date | null): Date | null {
    return configuredDeadline ? new Date(configuredDeadline) : null;
  }

  /** Tính hạn bổ sung loại trừ theo phương án tạm ngày 17/11/2026
   * supplementStartAt là mốc do Admin chọn và đã được API lưu theo UTC
   * Thứ Hai đến thứ Năm kết thúc lúc 00:00 sau ngày kế tiếp, thứ Sáu kết thúc lúc 00:00 ngày kế tiếp
   * Ngày mở cuối tuần hoặc ngày không hợp lệ bị từ chối để không tự dời sang thứ Hai
   */
  supplementDeadline(supplementStartAt: Date): Date {
    if (!Number.isFinite(supplementStartAt.getTime())) {
      throw new BadRequestException({
        code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
        message: "Thời gian mở bổ sung không hợp lệ",
      });
    }
    const vietnamDate = new Date(supplementStartAt.getTime() + VIETNAM_OFFSET_MS);
    const weekday = vietnamDate.getUTCDay();
    if (weekday === 0 || weekday === 6) {
      throw new BadRequestException({
        code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
        message: "Ngày mở bổ sung chỉ được chọn từ thứ Hai đến thứ Sáu",
      });
    }
    const daysUntilDeadline = weekday === 5 ? 1 : 2;
    return new Date(Date.UTC(
      vietnamDate.getUTCFullYear(),
      vietnamDate.getUTCMonth(),
      vietnamDate.getUTCDate() + daysUntilDeadline,
    ) - VIETNAM_OFFSET_MS);
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
