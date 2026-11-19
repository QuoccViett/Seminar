import { Controller, Get, Inject, Param, ParseUUIDPipe, PayloadTooLargeException, Put, Query, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { EvidencesService } from "./evidences.service.js";
import { MAX_FILE_BYTES } from "./file-policy.js";

/** Cổng bytes private dùng capability HMAC ngắn hạn, không có route public theo storage key
 * Không gắn whitelist Auth: đây là token riêng chỉ dùng đọc/tải tệp, không gọi được nghiệp vụ khác
 */
@ApiTags("Signed Evidence Storage")
@Controller("api/v1/storage")
export class StorageController {
  /** Nhận service để kiểm chữ ký, phiên tải và dữ liệu thật trong cùng luồng quyền */
  constructor(@Inject(EvidencesService) private readonly service: EvidencesService) {}

  /** Đọc stream có giới hạn sau kiểm capability, không dùng multipart hoặc tin Content-Length
   * Chỉ các MIME được cấp mới đi tiếp; request bị ngắt hoặc quá lớn không xác nhận Evidence
   */
  @Put("uploads/:uploadId")
  @ApiOperation({ summary: "Tải bytes bằng liên kết ngắn hạn đã được cấp" })
  async upload(@Param("uploadId", new ParseUUIDPipe({ version: "4" })) id: string, @Query("token") token: string, @Req() request: Request) {
    this.service.verifyToken("upload", id, token ?? "");
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > MAX_FILE_BYTES) throw new PayloadTooLargeException({ code: "FILE_TOO_LARGE", message: "Mỗi tệp không được vượt quá 10 MiB" });
      chunks.push(bytes);
    }
    return this.service.uploadBytes(id, token, Buffer.concat(chunks), String(request.headers["content-type"] ?? ""));
  }

  /** Trả bytes với no-store/nosniff và disposition tường minh, không phản chiếu filename vào header thô
   * Preview chỉ ảnh/PDF, CSP sandbox ngăn nội dung tài liệu thực thi trong origin backend
   */
  @Get("files/:evidenceId")
  @ApiOperation({ summary: "Đọc bytes qua liên kết tải hoặc xem trước đã ký" })
  async read(@Param("evidenceId", new ParseUUIDPipe({ version: "4" })) id: string, @Query("operation") operation: string, @Query("token") token: string, @Res() response: Response) {
    const file = await this.service.bytes(id, operation, token ?? "");
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    response.setHeader("Content-Disposition", `${operation === "preview" ? "inline" : "attachment"}; filename="minh-chung"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()]/g, (value) => `%${value.charCodeAt(0).toString(16)}`)}`);
    response.send(file.bytes);
  }
}
