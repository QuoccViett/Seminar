import { ApiProperty } from "@nestjs/swagger";

export class LeaderboardItemDto {
  /** Thứ tự toàn kỳ từ view; giữ chuỗi nếu vượt miền số nguyên an toàn của JSON */
  @ApiProperty({ oneOf: [{ type: "number" }, { type: "string" }], example: 1 })
  rank!: number | string;

  /** Các hồ sơ bằng điểm có cùng scoreRank dù thứ tự rank khác nhau */
  @ApiProperty({ oneOf: [{ type: "number" }, { type: "string" }], example: 1 })
  scoreRank!: number | string;

  @ApiProperty({ format: "uuid", type: String })
  evaluationId!: string;

  @ApiProperty({ format: "uuid", type: String })
  unitId!: string;

  @ApiProperty({ example: "DV001", type: String })
  unitCode!: string;

  @ApiProperty({ example: "Đơn vị A", type: String })
  unitName!: string;

  @ApiProperty({ example: "PENDING_REVIEW", type: String })
  status!: string;

  @ApiProperty({
    example: "2026-01-15T08:00:00.000Z",
    format: "date-time",
    nullable: true,
    type: String,
  })
  submittedAt!: string | null;

  @ApiProperty({ example: 300, type: Number })
  maxTotalScore!: number;

  @ApiProperty({ example: 280, type: Number })
  selfTotal!: number;

  @ApiProperty({ example: 285, type: Number })
  currentTotal!: number;

  @ApiProperty({ example: 95, type: Number })
  currentPercent!: number;

  @ApiProperty({ example: "EXCELLENT", nullable: true, type: String })
  suggestedRating!: string | null;

  /** Nhãn và màu lấy từ ngưỡng của kỳ, không tự gán từ enum trên giao diện */
  @ApiProperty({ nullable: true, type: String })
  ratingLabel!: string | null;

  @ApiProperty({ nullable: true, type: String })
  ratingColor!: string | null;

  /** Chỉ hồ sơ FINALIZED được coi là kết quả chính thức */
  @ApiProperty({ type: Boolean })
  isFinal!: boolean;
}

export class DashboardLeaderboardDto {
  @ApiProperty({ format: "uuid", type: String })
  periodId!: string;

  @ApiProperty({ example: 34, type: Number })
  totalUnits!: number;

  @ApiProperty({ type: () => LeaderboardItemDto, isArray: true })
  items!: LeaderboardItemDto[];
}
