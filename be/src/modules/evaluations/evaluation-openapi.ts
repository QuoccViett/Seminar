import type { SchemaObject } from "@nestjs/swagger";

/** Mô tả response công khai cho Swagger, tách khỏi model DB để không sinh field thẩm định ngoài quyền
 * Các schema chỉ hướng dẫn client, quyền/validation thực được service và DTO kiểm lại
 * Trường nullable giữ ý nghĩa chưa nhập hoặc chưa có mốc, field kết quả cuối chỉ có sau chốt
 */
const time: SchemaObject = { type: "string", format: "date-time", nullable: true };
const nullableNumber: SchemaObject = { type: "number", nullable: true };
const nullableText: SchemaObject = { type: "string", nullable: true };
const finalResult: SchemaObject = { type: "object", properties: { score: nullableNumber, percent: nullableNumber, rating: nullableText } };

/** Metadata dùng chung list/create/submit/detail, không chứa tiêu chí hoặc điểm trước giờ mở
 * serverTime luôn UTC không rỗng, canSubmit/lockedReason là snapshot tham khảo và ghi phải kiểm lại
 */
export const evaluationMetadataSchema: SchemaObject = {
  type: "object", required: ["id", "periodId", "period", "unit", "status", "serverTime", "criteriaVisible", "canSubmit", "lockedReason"], properties: {
    id: { type: "string", format: "uuid" }, periodId: { type: "string", format: "uuid" },
    period: { type: "object", properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, phase: { type: "string" }, selfEvalStart: time, selfEvalDeadline: time } },
    unit: { type: "object", properties: { id: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" } } },
    status: { type: "string", enum: ["DRAFT", "PENDING_REVIEW", "SUPPLEMENT_REQUESTED", "SUPPLEMENT_SUBMITTED", "SUPPLEMENT_EXPIRED", "FINALIZED"] },
    submittedAt: time, autoLockedAt: time, supplementStartAt: time, supplementDeadline: time, firstReviewedAt: time, supplementRequestedAt: time, supplementSubmittedAt: time,
    serverTime: { type: "string", format: "date-time" }, criteriaVisible: { type: "boolean" }, canSubmit: { type: "boolean" }, canSubmitSupplement: { type: "boolean" },
    lockedReason: nullableText, deadlineWarning: nullableText, finalResult,
    permissions: { type: "object", description: "Chỉ Admin nhận quyền thẩm định do server tính", properties: { canReview: { type: "boolean" }, canCompleteFirstReview: { type: "boolean" }, canRequestSupplement: { type: "boolean" }, canFinalize: { type: "boolean" } } },
  },
};

/** Detail trả cây có nhóm và lá, selfScore/selfNote chỉ trên lá còn field Admin chỉ ADMIN
 * children mô tả nút con cùng cấu trúc, cây rỗng trước mở với UNIT theo projection của service
 * Minh chứng chỉ metadata, không mô tả storagePath hoặc credential vì API không trả các trường đó
 */
export const evaluationDetailSchema: SchemaObject = {
  ...evaluationMetadataSchema, properties: { ...evaluationMetadataSchema.properties,
  summary: { type: "object", description: "Tổng tự chấm theo evaluationSummarySchema, cùng snapshot với cây; chỉ có khi criteriaVisible=true" },
  criteria: { type: "array", items: {
    type: "object", properties: {
      criterionId: { type: "string", format: "uuid" }, code: { type: "string" }, name: { type: "string" }, description: nullableText, maxScore: { type: "number" },
      evidenceRequirement: nullableText, evidenceRequired: { type: "boolean" }, allowText: { type: "boolean" }, allowFile: { type: "boolean" }, allowLink: { type: "boolean" },
      children: { type: "array", items: { type: "object", description: "Nút tiêu chí con cùng cấu trúc, lá có children rỗng" } },
      selfScore: nullableNumber, selfNote: nullableText, canEditSelf: { type: "boolean" }, lockedReason: nullableText, serverTime: { type: "string", format: "date-time" },
      needsSupplement: { type: "boolean" }, supplementNote: nullableText,
      adminScore: { ...nullableNumber, description: "Chỉ trả cho ADMIN" }, adminComment: { ...nullableText, description: "Chỉ trả cho ADMIN" },
      reviewedById: { ...nullableText, description: "Chỉ trả cho ADMIN" }, reviewedByName: nullableText, reviewedAt: time, supplementedAt: time,
      supplementChanged: { type: "boolean", description: "Chỉ Admin, nội dung cuối khác baseline" },
      supplementBaseline: { type: "object", nullable: true, description: "Chỉ Admin, snapshot trước bổ sung không chứa storagePath", properties: { capturedAt: time, source: { type: "string" }, content: { type: "object", properties: { selfScore: nullableText, selfNote: nullableText, evidenceIds: { type: "array", items: { type: "string", format: "uuid" } } } }, review: { type: "object", properties: { adminScore: nullableText, adminComment: nullableText, reviewedById: nullableText, reviewedAt: time } } } },
      evidences: { type: "array", items: { type: "object", properties: { id: { type: "string", format: "uuid" }, kind: { type: "string", enum: ["FILE", "LINK"] }, round: { type: "string", enum: ["INITIAL", "SUPPLEMENT"] }, fileName: nullableText, mimeType: nullableText, sizeBytes: nullableText, externalUrl: nullableText, description: nullableText, previewStatus: { type: "string" } } } },
    },
  } } },
};

/** Summary chỉ có tổng tự chấm và ngưỡng công khai, không dùng currentTotal/currentPercent
 * percent làm tròn hiển thị còn suggestedRating so ngưỡng chính xác, finalResult chỉ có sau chốt
 */
export const evaluationSummarySchema: SchemaObject = { type: "object", properties: {
  evaluationId: { type: "string", format: "uuid" }, selfTotal: { type: "number" }, maxTotalScore: { type: "number" }, selfPercent: { type: "number" },
  suggestedRating: nullableText, ratingLabel: nullableText, ratingColor: nullableText, scoredCount: { type: "integer" }, leafCount: { type: "integer" }, isFinal: { type: "boolean" }, finalResult,
} };

/** Kết quả lưu đơn chỉ chứa dữ liệu tự chấm đã commit và thời điểm server cấp */
export const savedSelfScoreSchema: SchemaObject = { type: "object", properties: {
  evaluationId: { type: "string", format: "uuid" }, criterionId: { type: "string", format: "uuid" }, selfScore: nullableNumber, selfNote: nullableText, updatedAt: { type: "string", format: "date-time" },
} };

/** Batch giữ thứ tự đầu vào, mỗi phần tử là thành công có data hoặc lỗi công khai đã chuẩn hóa
 * HTTP 200 không có nghĩa mọi ô thành công, client cần kiểm ok từng phần tử
 */
export const batchSelfScoreSchema: SchemaObject = { type: "object", properties: { results: { type: "array", items: { oneOf: [
  { type: "object", required: ["criterionId", "ok", "data"], properties: { criterionId: { type: "string", format: "uuid" }, ok: { type: "boolean", enum: [true] }, data: savedSelfScoreSchema } },
  { type: "object", required: ["criterionId", "ok", "error"], properties: { criterionId: { type: "string", format: "uuid" }, ok: { type: "boolean", enum: [false] }, error: { $ref: "#/components/schemas/ApiError" } } },
] } } } };
