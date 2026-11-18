import { ApiProperty } from "@nestjs/swagger";

export class CriterionDeductionDto {
  @ApiProperty({ format: "uuid", type: String })
  criterionId!: string;

  @ApiProperty({ example: "A1", type: String })
  code!: string;

  @ApiProperty({
    example: "Tổ chức học tập nghị quyết, chủ trương",
    type: String,
  })
  name!: string;

  @ApiProperty({ example: 15, type: Number })
  unitsDeducted!: number;

  @ApiProperty({ example: 25.5, type: Number })
  totalPointsDeducted!: number;
}

export class DashboardDeductionsDto {
  @ApiProperty({ format: "uuid", type: String })
  periodId!: string;

  @ApiProperty({ type: () => CriterionDeductionDto, isArray: true })
  items!: CriterionDeductionDto[];
}

/** Mỗi dòng drill-down trỏ đúng hồ sơ đã chốt có chênh lệch dương của tiêu chí */
export class CriterionDeductionDetailDto {
  @ApiProperty({ format: "uuid", type: String }) evaluationId!: string;
  @ApiProperty({ format: "uuid", type: String }) unitId!: string;
  @ApiProperty({ type: String }) unitCode!: string;
  @ApiProperty({ type: String }) unitName!: string;
  @ApiProperty({ type: Number }) selfScore!: number;
  @ApiProperty({ type: Number }) adminScore!: number;
  @ApiProperty({ type: Number }) pointsDeducted!: number;
}

/** Bao gồm kỳ và tiêu chí để FE đối chiếu trước khi mở liên kết hồ sơ */
export class DashboardDeductionDetailDto {
  @ApiProperty({ format: "uuid", type: String }) periodId!: string;
  @ApiProperty({ format: "uuid", type: String }) criterionId!: string;
  @ApiProperty({ type: () => CriterionDeductionDetailDto, isArray: true }) items!: CriterionDeductionDetailDto[];
}
