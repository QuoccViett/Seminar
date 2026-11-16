import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { HttpLoggingMiddleware } from "./http-logging.middleware.js";
import type { Request, Response } from "express";

/** Kiểm tra cả log lúc nhận và hoàn tất không chứa bí mật trong URL, header hoặc body
 * Giả lập response phát sự kiện finish và thu log để kiểm tra dữ liệu ở ranh giới ghi
 */
test("log HTTP chỉ ghi metadata cho phép", () => {
  const middleware = new HttpLoggingMiddleware();
  const messages: string[] = [];
  (middleware as unknown as { logger: { log: (value: string) => void } }).logger.log = (value) => messages.push(value);
  const response = Object.assign(new EventEmitter(), { setHeader: () => {}, statusCode: 200 });
  const request = { method: "POST", path: "/token-bi-mat", query: { token: "token-bi-mat" }, headers: { authorization: "token-bi-mat" }, body: { password: "mat-khau-thu" } };
  let nextCalled = false;
  middleware.use(request as unknown as Request, response as unknown as Response, () => { nextCalled = true; });
  response.emit("finish");
  assert.equal(nextCalled, true);
  assert.equal(messages.length, 2);
  assert.doesNotMatch(messages.join(" "), /token-bi-mat|mat-khau-thu/);
});
