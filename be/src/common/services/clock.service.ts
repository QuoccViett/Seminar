import { Injectable } from "@nestjs/common";

@Injectable()
export class ClockService {
  private fixedTime?: Date;

  /** Trả bản sao thời gian cố định khi kiểm thử hoặc thời gian hiện tại của máy chủ
   * Bản sao ngăn phía gọi thay đổi thời gian dùng cho các phép tính tiếp theo
   */
  now(): Date {
    return new Date(this.fixedTime ?? Date.now());
  }

  /** Đặt thời gian thử nghiệm từ Date, timestamp hoặc chuỗi ISO có múi giờ rõ ràng
   * Từ chối ngày không hợp lệ và chuỗi thiếu múi giờ để tránh phụ thuộc múi giờ máy
   */
  set(time: Date | string | number): void {
    if (typeof time === "string" && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(time)) throw new Error("Thời gian phải có múi giờ rõ ràng");
    const value = new Date(time);
    if (!Number.isFinite(value.getTime())) throw new Error("Thời gian không hợp lệ");
    this.fixedTime = value;
  }

  /** Trở lại đồng hồ máy chủ sau khi hoàn tất kiểm thử */
  reset(): void {
    this.fixedTime = undefined;
  }
}
