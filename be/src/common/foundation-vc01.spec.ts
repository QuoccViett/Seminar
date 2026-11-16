import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { validateEnvironment } from "../config/env.validation.js";
import { ClockService } from "./services/clock.service.js";
import { ApiArrayValidationPipe, createApiValidationPipe } from "./pipes/api-validation.pipe.js";
import { IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { Prisma } from "../generated/prisma/client.js";
import { serializeApiValue } from "./interceptors/api-serialization.interceptor.js";

class ItemDto {
  @IsString({ message: "Tên phải là chuỗi" })
  name!: string;
}
class RequestDto {
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items!: ItemDto[];
}

/** Kiểm tra provider tắt không cần secret, production và provider bật phải có cấu hình
 * Đầu vào là tập biến độc lập, kết quả lỗi không được chứa giá trị bí mật thử nghiệm
 */
test("cấu hình theo tính năng và mật khẩu demo", () => {
  const base = { DATABASE_URL: "postgresql://localhost/test", JWT_SECRET: "x".repeat(32), CORS_ORIGINS: "http://localhost:5173" };
  const result = validateEnvironment(base);
  assert.equal(result.INITIAL_ACCOUNT_PASSWORD, "123456");
  assert.equal(result.ZALO_ZNS_ENABLED, false);
  assert.throws(() => validateEnvironment({ ...base, NODE_ENV: "production" }), /INITIAL_ACCOUNT_PASSWORD/);
  assert.throws(() => validateEnvironment({ ...base, WEB_PUSH_ENABLED: true }), /WEB_PUSH_VAPID/);
  assert.throws(() => validateEnvironment({ ...base, ZALO_ZNS_ENABLED: true }), /ZALO_/);
  assert.throws(() => validateEnvironment({ ...base, STORAGE_ENABLED: true }), /SUPABASE_/);
  assert.throws(() => validateEnvironment({ ...base, CORS_ORIGINS: "*" }), /CORS/);
  assert.throws(() => validateEnvironment({ ...base, CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64") }), /32 byte/);
  assert.doesNotThrow(() => validateEnvironment({ ...base, CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") }));
});

/** Kiểm tra body mảng không bị chuyển thành object và lỗi phần tử có chỉ số ổn định
 * Trường lạ và phần tử không phải object đều bị từ chối trước khi gọi service
 */
test("validation body mảng kiểm từng phần tử", async () => {
  const pipe = new ApiArrayValidationPipe(ItemDto);
  const valid = await pipe.transform([{ name: "Hợp lệ" }]);
  assert.equal(valid[0].name, "Hợp lệ");
  await assert.rejects(pipe.transform([{ name: 42, extra: true }, null]), (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    const body = error.getResponse() as { details: Array<{ field: string }> };
    assert.deepEqual(body.details.map((item) => item.field).sort(), ["0.extra", "0.name", "1"]);
    return true;
  });
});

/** Kiểm tra đường dẫn nested chứa chỉ số mảng và trường lạ bị từ chối
 * Giá trị sai là dữ liệu giả, kết quả không được chứa target hoặc nội dung đầu vào
 */
test("validation giữ đường dẫn lồng nhau và che giá trị", async () => {
  const pipe = createApiValidationPipe();
  await assert.rejects(pipe.transform({ items: [{ name: 10, extra: "bi-mat-thu" }] }, { type: "body", metatype: RequestDto }), (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    const body = error.getResponse() as { details: Array<{ field: string }> };
    assert.deepEqual(body.details.map((item) => item.field).sort(), ["items.0.extra", "items.0.name"]);
    assert.doesNotMatch(JSON.stringify(body), /bi-mat-thu/);
    return true;
  });
});

/** Kiểm tra đồng hồ trả bản sao và từ chối chuỗi không xác định múi giờ
 * Khi reset, đồng hồ quay về thời gian máy chủ thay vì giữ mốc cố định
 */
test("đồng hồ kiểm thử không phụ thuộc múi giờ máy", () => {
  const clock = new ClockService();
  assert.throws(() => clock.set("2026-01-01T00:00:00"), /múi giờ/);
  assert.throws(() => clock.set("sai"), /múi giờ/);
  clock.set("2026-01-01T00:00:00Z");
  clock.now().setUTCFullYear(2000);
  assert.equal(clock.now().toISOString(), "2026-01-01T00:00:00.000Z");
  clock.reset();
});

/** Kiểm tra độ chính xác khi chuyển Decimal, BigInt và Date trong dữ liệu lồng nhau
 * Số nguyên vượt giới hạn an toàn phải thành chuỗi và không làm thay đổi đầu vào
 */
test("chuyển kiểu Prisma sang JSON an toàn", () => {
  const input = { values: [new Prisma.Decimal("12.345"), 42n, 9007199254740992n], time: new Date("2026-01-01T00:00:00Z") };
  assert.deepEqual(serializeApiValue(input), { values: [12.35, 42, "9007199254740992"], time: "2026-01-01T00:00:00.000Z" });
  assert.equal(input.values[1], 42n);
});
