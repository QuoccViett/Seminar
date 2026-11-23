import Joi from "joi";

/** Các nhóm tích hợp chỉ bắt buộc thông tin xác thực khi được bật rõ ràng
 * Giá trị mặc định demo áp dụng ngoài production, ZNS luôn mặc định tắt
 * Schema chỉ khai báo cấu hình, không gửi thông báo hoặc kích hoạt provider
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  // Công cụ chạy quét thủ công mặc định tắt và không được bật tại production
  ENABLE_DEMO_TOOLS: Joi.when("NODE_ENV", { is: "production", then: Joi.boolean().valid(false).default(false), otherwise: Joi.boolean().default(false) }),
  TRUST_PROXY: Joi.string().allow("").default(""),
  RATE_LIMIT_ENABLED: Joi.when("NODE_ENV", { is: "production", then: Joi.boolean().valid(true).default(true), otherwise: Joi.boolean().default(true) }),
  SWAGGER_ENABLED: Joi.when("NODE_ENV", { is: "production", then: Joi.boolean().valid(false).default(false), otherwise: Joi.boolean().default(true) }),
  PORT: Joi.number().port().default(3000),
  WEB_ORIGINS: Joi.string().optional(),
  CORS_ORIGINS: Joi.string().optional(),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(1).default(900),
  JWT_REFRESH_TTL_SECONDS: Joi.number().integer().min(1).default(604800),
  JWT_ISSUER: Joi.string().default("seminar"),
  JWT_AUDIENCE: Joi.string().default("seminar-client"),
  INITIAL_ACCOUNT_PASSWORD: Joi.when("NODE_ENV", {
    is: "production", then: Joi.string().min(6).required(), otherwise: Joi.string().min(6).default("123456"),
  }),
  CREDENTIALS_ENCRYPTION_KEY: Joi.string().allow("").optional(),
  PUBLIC_APP_URL: Joi.string().uri({ scheme: ["http", "https"] }).optional(),
  WEB_PUSH_ENABLED: Joi.boolean().default(false),
  WEB_PUSH_ALLOWED_HOSTS: Joi.string().optional(),
  WEB_PUSH_VAPID_PUBLIC_KEY: Joi.when("WEB_PUSH_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  WEB_PUSH_VAPID_PRIVATE_KEY: Joi.when("WEB_PUSH_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  WEB_PUSH_SUBJECT: Joi.when("WEB_PUSH_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  EMAIL_ENABLED: Joi.boolean().default(false),
  SMTP_HOST: Joi.when("EMAIL_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_AUTH_REQUIRED: Joi.boolean().default(true),
  SMTP_ALLOW_INSECURE_LOCAL: Joi.boolean().default(false),
  SMTP_SECURE: Joi.boolean().optional(),
  SMTP_USER: Joi.string().allow("").optional(),
  SMTP_PASSWORD: Joi.string().allow("").optional(),
  SMTP_PASS: Joi.string().allow("").optional(),
  MAIL_FROM: Joi.string().email({ tlds: { allow: false } }).allow("").optional(),
  SMTP_FROM: Joi.string().email({ tlds: { allow: false } }).allow("").optional(),
  ZALO_ZNS_ENABLED: Joi.boolean().default(false),
  ZALO_APP_ID: Joi.when("ZALO_ZNS_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  ZALO_APP_SECRET: Joi.when("ZALO_ZNS_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  ZALO_OA_ID: Joi.when("ZALO_ZNS_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  ZALO_TEMPLATE_MAP: Joi.when("ZALO_ZNS_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  STORAGE_ENABLED: Joi.boolean().default(false),
  // Kho local phục vụ dev/test, Supabase chỉ yêu cầu secret khi chọn provider và bật storage
  STORAGE_PROVIDER: Joi.string().valid("local", "supabase").default("local"),
  STORAGE_LOCAL_DIR: Joi.string().default(".private-storage"),
  STORAGE_BUCKET: Joi.string().pattern(/^[a-z0-9][a-z0-9-]{1,62}$/).default("evidences"),
  SUPABASE_URL: Joi.string().uri({ scheme: ["https"] }).allow("").optional(),
  SUPABASE_KEY: Joi.string().allow("").optional(),
  REPORT_EXPORT_DIR: Joi.string().allow("").optional(),
  REPORT_EXPORT_FONT_PATH: Joi.string().allow("").optional(),
  // Giới hạn URL tải ở server, FE luôn xin metadata mới trước khi tải thay vì tin giờ máy
  REPORT_EXPORT_DOWNLOAD_TTL_SECONDS: Joi.number().integer().min(30).max(300).default(120),
  OPENAPI_OUTPUT_FILE: Joi.string().allow("").optional(),
  SEED_CREDENTIALS_FILE: Joi.string().default(".seed-credentials.json"),
  SEED_ADMIN_PASSWORD: Joi.string().allow("").optional(),
  SEED_ROTATE_PASSWORDS: Joi.boolean().default(false),
  SEED_ADMIN_USERNAME: Joi.string().allow("").optional(),
  SEED_ADMIN_EMAIL: Joi.string().email({ tlds: { allow: false } }).allow("").optional(),
}).or("WEB_ORIGINS", "CORS_ORIGINS");

/** Kiểm tra cấu hình khi khởi động và chỉ nêu tên biến sai, không ghi giá trị bí mật
 * Chấp nhận biến ngoài schema để các module khác tiếp tục nhận cấu hình riêng
 * CORS chỉ nhận origin cụ thể nhằm tránh vô tình mở truy cập cho mọi website
 */
export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const result = envValidationSchema.validate(input, { allowUnknown: true, abortEarly: false });
  if (result.error) {
    const fields = [...new Set(result.error.details.flatMap((detail) => detail.path.map(String)))];
    throw new Error(`Cấu hình không hợp lệ hoặc còn thiếu: ${fields.join(", ") || "CORS_ORIGINS, WEB_ORIGINS"}`);
  }
  const origins = String(result.value.CORS_ORIGINS ?? result.value.WEB_ORIGINS).split(",");
  if (origins.some((origin) => {
    try {
      const url = new URL(origin.trim());
      return !["http:", "https:"].includes(url.protocol) || url.origin !== origin.trim();
    } catch { return true; }
  })) throw new Error("Cấu hình CORS_ORIGINS hoặc WEB_ORIGINS phải là origin HTTP hoặc HTTPS cụ thể");
  const normalized = result.value as Record<string, unknown>;
  if (normalized.TRUST_PROXY && /^(?:true|\d+|\*|0\.0\.0\.0\/0|::\/0)$/i.test(String(normalized.TRUST_PROXY))) throw new Error("TRUST_PROXY phải là mạng proxy tin cậy cụ thể");
  if (normalized.NODE_ENV === "production") {
    if (origins.some((origin) => new URL(origin.trim()).protocol !== "https:")) throw new Error("Production yêu cầu CORS HTTPS");
    if (!normalized.PUBLIC_APP_URL || new URL(String(normalized.PUBLIC_APP_URL)).protocol !== "https:") throw new Error("Production yêu cầu PUBLIC_APP_URL HTTPS");
    if (/replace|change.?me|example|ci-only/i.test(String(normalized.JWT_SECRET))) throw new Error("Production yêu cầu JWT_SECRET ngẫu nhiên riêng");
  }
  // Không kích hoạt provider ngoài khi thiếu cấu hình, không dùng kho local trong production
  // Bucket private được provider kiểm thực tế trước I/O, không tự thay ACL của môi trường
  if (normalized.STORAGE_ENABLED && normalized.STORAGE_PROVIDER === "supabase" && (!normalized.SUPABASE_URL || !normalized.SUPABASE_KEY)) throw new Error("Cần cấu hình SUPABASE_URL và SUPABASE_KEY khi bật kho Supabase");
  if (normalized.STORAGE_ENABLED && normalized.NODE_ENV === "production" && normalized.STORAGE_PROVIDER === "local") throw new Error("Môi trường production cần kho riêng tư Supabase, không dùng kho cục bộ");
  // Chuẩn hóa bí danh Gmail về tên canonical trước khi kiểm tra điều kiện và khởi tạo provider
  // Cho phép môi trường cũ tiếp tục chạy mà không làm thay đổi mặc định Email đang tắt
  if (!normalized.MAIL_FROM && normalized.SMTP_FROM) normalized.MAIL_FROM = normalized.SMTP_FROM;
  if (!normalized.SMTP_PASSWORD && normalized.SMTP_PASS) normalized.SMTP_PASSWORD = normalized.SMTP_PASS;
  if (normalized.EMAIL_ENABLED && !normalized.SMTP_HOST) throw new Error("SMTP_HOST là bắt buộc khi bật xác thực Email");
  if (normalized.EMAIL_ENABLED && !normalized.MAIL_FROM) throw new Error("MAIL_FROM hoặc SMTP_FROM là bắt buộc khi bật xác thực Email");
  if (normalized.ZALO_ZNS_ENABLED) {
    try {
      const map: unknown = JSON.parse(String(result.value.ZALO_TEMPLATE_MAP));
      if (!map || Array.isArray(map) || typeof map !== "object" || Object.values(map).length === 0 ||
        Object.values(map).some((value) => typeof value !== "string" || !value.trim())) throw new Error("Danh sách mẫu không hợp lệ");
    } catch { throw new Error("Cấu hình ZALO_TEMPLATE_MAP phải là đối tượng JSON chứa mã mẫu hợp lệ"); }
    throw new Error("Zalo ZNS chưa có provider gửi thật; giữ ZALO_ZNS_ENABLED=false cho đến khi tích hợp được kích hoạt");
  }
  if (normalized.CREDENTIALS_ENCRYPTION_KEY) {
    const key = String(normalized.CREDENTIALS_ENCRYPTION_KEY);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").length !== 32) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY phải là khóa base64 có độ dài giải mã 32 byte");
    }
  }
  // SMTP thật cần xác thực và TLS; Mailpit chỉ được miễn qua cờ riêng cùng host loopback ở môi trường không production
  if (normalized.EMAIL_ENABLED && normalized.SMTP_AUTH_REQUIRED && (!normalized.SMTP_USER || !normalized.SMTP_PASSWORD)) throw new Error("Cấu hình SMTP_USER và SMTP_PASSWORD hoặc SMTP_PASS là bắt buộc khi bật xác thực Email");
  if (normalized.EMAIL_ENABLED && !normalized.SMTP_AUTH_REQUIRED && !(normalized.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(String(normalized.SMTP_HOST)))) throw new Error("SMTP không xác thực chỉ được dùng với Mailpit cục bộ ở môi trường thử nghiệm");
  if (normalized.EMAIL_ENABLED && (normalized.SMTP_PORT === 25 || normalized.SMTP_PORT === 1025) && !(normalized.NODE_ENV !== "production" && normalized.SMTP_ALLOW_INSECURE_LOCAL && ["localhost", "127.0.0.1", "::1"].includes(String(normalized.SMTP_HOST)))) throw new Error("SMTP không mã hóa chỉ được phép cho Mailpit cục bộ ở môi trường thử nghiệm");
  if ((normalized.EMAIL_ENABLED || normalized.WEB_PUSH_ENABLED) && !normalized.CREDENTIALS_ENCRYPTION_KEY) throw new Error("CREDENTIALS_ENCRYPTION_KEY là bắt buộc khi bật Email hoặc Web Push để cấp thông tin đăng nhập an toàn");
  if (normalized.WEB_PUSH_ALLOWED_HOSTS && String(normalized.WEB_PUSH_ALLOWED_HOSTS).split(",").some((host) => !/^[a-z0-9.-]+$/.test(host.trim()) || host.trim().startsWith(".") || host.trim().endsWith("."))) throw new Error("WEB_PUSH_ALLOWED_HOSTS phải là danh sách tên miền hợp lệ");
  return normalized;
}
