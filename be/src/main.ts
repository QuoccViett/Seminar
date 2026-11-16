import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { ConfigService } from "@nestjs/config";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import { createApiValidationPipe } from "./common/pipes/api-validation.pipe.js";
import { ApiSerializationInterceptor } from "./common/interceptors/api-serialization.interceptor.js";
import helmet from "helmet";
import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Khởi động ứng dụng, đăng ký lớp bảo vệ HTTP và mở cổng đã cấu hình
 * Cố định múi giờ tiến trình trước khi kết nối DB để dữ liệu timestamp được diễn giải nhất quán
 * Nếu cấu hình hoặc DB lỗi thì dừng khởi động và không in thông tin nhạy cảm
 */
async function bootstrap(): Promise<void> {
  process.env.TZ = "UTC";
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);

  // Helmet mặc định có "upgrade-insecure-requests" -> Swagger UI trên http://localhost
  // bị ép tải css/js qua https và hiện trang trắng. Bỏ directive đó và cho phép inline script.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "script-src": ["'self'", "'unsafe-inline'"],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ApiSerializationInterceptor());
  // Giới hạn parser được cài trước bộ lọc và pipe để lỗi đầu vào vẫn theo contract
  app.useGlobalPipes(createApiValidationPipe());

  const allowedOrigins = (
    config.get<string>("CORS_ORIGINS") ??
    config.get<string>("WEB_ORIGINS") ??
    "http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => Boolean(origin) && origin !== "*");
  if (allowedOrigins.length === 0) {
    throw new Error(
      "Cần cấu hình ít nhất một origin cụ thể trong CORS_ORIGINS hoặc WEB_ORIGINS",
    );
  }
  app.enableCors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  });

  // Không dùng addSecurityRequirements() toàn cục: login/refresh là public.
  // Các endpoint cần token đã có @ApiBearerAuth("access-token") ở controller.
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Seminar Evaluation API")
    .setDescription("API documentation for the Seminar evaluation application.")
    .setVersion("1.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Dán accessToken nhận được từ POST /api/v1/auth/login (không cần gõ chữ Bearer).",
      },
      "access-token",
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  swaggerDocument.components ??= {};
  swaggerDocument.components.schemas ??= {};
  swaggerDocument.components.schemas.ApiError = {
    type: "object",
    required: ["statusCode", "code", "message", "details"],
    properties: {
      statusCode: { type: "integer", example: 400 },
      code: { type: "string", example: "VALIDATION_ERROR" },
      message: { type: "string", example: "Dữ liệu gửi lên không hợp lệ." },
      details: {
        type: "array",
        items: { type: "object" },
        example: [{ field: "username", messages: ["Tên đăng nhập là bắt buộc."] }],
      },
    },
  };
  for (const pathItem of Object.values(swaggerDocument.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (operation && typeof operation === "object" && "responses" in operation) {
        const responses = operation.responses as Record<string, { description?: string }>;
        for (const status of ["400", "401", "403", "404", "409", "500", "503"]) {
          if (responses[status]) {
            responses[status] = {
              ...responses[status],
              content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
            } as (typeof responses)[string];
          }
        }
      }
    }
  }

  SwaggerModule.setup("api/docs", app, swaggerDocument, {
    jsonDocumentUrl: "api/docs-json",
    swaggerOptions: { persistAuthorization: true },
  });

  // Chỉ xuất tệp khi có đích được chỉ định để không ghi đè tài liệu sẵn có lúc khởi động
  const outputFile = config.get<string>("OPENAPI_OUTPUT_FILE");
  if (outputFile) {
    try {
      const outputPath = resolve(outputFile);
      await mkdir(resolve(outputPath, ".."), { recursive: true });
      await writeFile(outputPath, JSON.stringify(swaggerDocument, null, 2), "utf8");
    } catch {
      console.warn("Không ghi được tài liệu OpenAPI");
    }
  }

  app.enableShutdownHooks();
  await app.listen(config.get<number>("PORT", 3000));
}

bootstrap().catch(() => {
  console.error("Không thể khởi động ứng dụng NestJS.");
  process.exitCode = 1;
});
