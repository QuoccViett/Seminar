import { BadRequestException } from "@nestjs/common";

type Threshold = { rating: string; minPercent: unknown; minExclusive?: boolean; label?: string };

/** Kiểm toàn bộ cấu hình trước lưu và trước công bố, không thay đổi cấu hình kỳ cũ */
export function assertRatingThresholds(thresholds: Threshold[]): void {
  const ratings = ["FAIL", "PASS", "GOOD", "EXCELLENT"];
  const fail = () => { throw new BadRequestException({ code: "BUSINESS_RULE_VIOLATION", message: "Cần đủ bốn mức khác nhau, FAIL = 0 < PASS < GOOD < EXCELLENT < 100; chỉ EXCELLENT dùng cận loại trừ và mỗi mức phải có nhãn" }); };
  if (thresholds.length !== 4 || new Set(thresholds.map((item) => item.rating)).size !== 4) fail();
  let previous = -1;
  for (const rating of ratings) {
    const item = thresholds.find((threshold) => threshold.rating === rating);
    if (!item) return fail();
    const value = Number(item.minPercent);
    if (!item.label?.trim() || item.minPercent === null || !Number.isFinite(value) || value < 0 || value >= 100 || value <= previous ||
      Math.abs(value * 100 - Math.round(value * 100)) > 1e-8 ||
      (rating === "FAIL" && value !== 0) || Boolean(item.minExclusive) !== (rating === "EXCELLENT")) fail();
    previous = value;
  }
}
