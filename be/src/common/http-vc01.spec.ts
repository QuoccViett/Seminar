import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Body, Controller, Get, Module, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FileInterceptor } from "@nestjs/platform-express";
import express from "express";
import { AllExceptionsFilter } from "./filters/all-exceptions.filter.js";
import { HttpLoggingMiddleware } from "./middleware/http-logging.middleware.js";

@Controller("kiem-tra")
class TestController {
  /** Trả nội dung hợp lệ để kiểm chứng parser mà không gọi dịch vụ ngoài */
  @Post()
  receive(@Body() body: unknown): unknown { return body; }

  /** Nhận tệp thử có giới hạn nhỏ để kiểm tra nhánh lỗi Multer qua HTTP thật */
  @Post("tep")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 4 } }))
  upload(@UploadedFile() file: unknown): unknown { return { received: Boolean(file) }; }

  /** Tạo lỗi provider giả chứa bí mật để kiểm tra filter không phản chiếu nội dung */
  @Get("provider")
  provider(): never { throw new Error("provider-secret-thu"); }
}
@Module({ controllers: [TestController] })
class TestModule {}

/** Khởi động Nest và Express thật trên cổng ngẫu nhiên chỉ dành cho kiểm thử
 * JSON hỏng, body lớn và tuyến lạ phải có đủ bốn trường, không lộ nội dung thử
 * Không kết nối cơ sở dữ liệu nên kết quả không thay thế kiểm thử tích hợp PostgreSQL
 */
test("lỗi parser và tuyến lạ qua HTTP thật", async () => {
  const app = await NestFactory.create(TestModule, { logger: false, bodyParser: false });
  const entries: string[] = [];
  const logging = new HttpLoggingMiddleware();
  (logging as unknown as { logger: { log: (message: string) => void } }).logger.log = (message) => entries.push(message);
  app.use(logging.use.bind(logging));
  app.use(express.json({ limit: "1kb" }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, "127.0.0.1");
  try {
    const base = await app.getUrl();
    for (const [path, options, status] of [
      ["/kiem-tra", { method: "POST", headers: { "content-type": "application/json" }, body: '{"password":"bi-mat-thu"' }, 400],
      ["/kiem-tra", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "a".repeat(2048) }) }, 413],
      ["/khong-ton-tai", {}, 404],
      ["/kiem-tra/provider", {}, 500],
    ] as const) {
      const response = await fetch(base + path, options);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(response.status, status);
      assert.deepEqual(Object.keys(body).sort(), ["code", "details", "message", "statusCode"]);
      assert.match(String(body.message), /[À-ỹ]/u);
      assert.doesNotMatch(JSON.stringify(body), /bi-mat-thu|provider-secret-thu|Cannot|SyntaxError/);
    }
    const file = new FormData();
    file.append("file", new Blob(["123456789"]), "thu.txt");
    const tooLarge = await fetch(base + "/kiem-tra/tep", { method: "POST", body: file });
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(Object.keys(await tooLarge.json() as object).sort(), ["code", "details", "message", "statusCode"]);
    const malformed = await fetch(base + "/kiem-tra/tep", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=vc01" }, body: "--vc01\r\n" });
    assert.equal(malformed.status, 400);
    assert.match(String(((await malformed.json()) as { message: string }).message), /[À-ỹ]/u);
    assert.doesNotMatch(entries.join(" "), /bi-mat-thu|provider-secret-thu/);
  } finally { await app.close(); }
});
