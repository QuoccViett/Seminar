import type { SchemaObject } from "@nestjs/swagger";

/** Schema công khai của VC13, tách model DB để Swagger không lộ quan hệ User hoặc bí mật
 * Các field actor null và snapshot null có ý nghĩa hệ thống/chưa có dữ liệu, không thay bằng chuỗi rỗng
 */
const uuid: SchemaObject = { type: "string", format: "uuid" };
const text: SchemaObject = { type: "string" };
const timestamp: SchemaObject = { type: "string", format: "date-time" };
const pagination: Record<string, SchemaObject> = { page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" } };
export const feedbackSchema: SchemaObject = { type: "object", properties: { id: uuid, evaluationId: uuid, authorId: uuid, authorName: text, type: { type: "string", enum: ["GENERAL", "EXPLANATION_REQUEST", "UNIT_REPLY", "SUPPLEMENT_REQUEST"] }, content: text, createdAt: timestamp } };
export const feedbackPageSchema: SchemaObject = { type: "object", properties: { ...pagination, items: { type: "array", items: feedbackSchema }, canPost: { type: "boolean" }, allowedTypes: { type: "array", items: text }, lockedReason: { type: "string", nullable: true } } };
export const historyPageSchema: SchemaObject = { type: "object", properties: { ...pagination, items: { type: "array", items: { type: "object", properties: { id: uuid, evaluationId: uuid, actorId: { ...uuid, nullable: true }, actorName: text, fromStatus: { type: "string", nullable: true }, toStatus: text, comment: { type: "string", nullable: true }, createdAt: timestamp } } } } };
export const auditSchema: SchemaObject = { type: "object", properties: { id: uuid, actorId: { ...uuid, nullable: true }, actorName: text, entity: text, entityId: text, action: text, ip: { type: "string", nullable: true }, before: { nullable: true }, after: { nullable: true }, createdAt: timestamp } };
export const auditPageSchema: SchemaObject = { type: "object", properties: { ...pagination, items: { type: "array", items: auditSchema } } };
