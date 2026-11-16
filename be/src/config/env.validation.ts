import Joi from "joi";

/** Các nhóm tích hợp chỉ bắt buộc thông tin xác thực khi được bật rõ ràng
 * Giá trị mặc định demo áp dụng ngoài production, ZNS luôn mặc định tắt
 * Schema chỉ khai báo cấu hình, không gửi thông báo hoặc kích hoạt provider
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().port().default(3000),
  WEB_ORIGINS: Joi.string().optional(),
  CORS_ORIGINS: Joi.string().optional(),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  INITIAL_ACCOUNT_PASSWORD: Joi.when("NODE_ENV", {
    is: "production", then: Joi.string().min(6).required(), otherwise: Joi.string().min(6).default("123456"),
  }),
  CREDENTIALS_ENCRYPTION_KEY: Joi.string().allow("").optional(),
  WEB_PUSH_ENABLED: Joi.boolean().default(false),
  WEB_PUSH_VAPID_PUBLIC_KEY: Joi.when("WEB_PUSH_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  WEB_PUSH_VAPID_PRIVATE_KEY: Joi.when("WEB_PUSH_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  WEB_PUSH_SUBJECT: Joi.when("WEB_PUSH_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  EMAIL_ENABLED: Joi.boolean().default(false),
  SMTP_HOST: Joi.when("EMAIL_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.when("EMAIL_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  SMTP_PASSWORD: Joi.when("EMAIL_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  MAIL_FROM: Joi.when("EMAIL_ENABLED", { is: true, then: Joi.string().email({ tlds: { allow: false } }).required(), otherwise: Joi.string().allow("").optional() }),
  ZALO_ZNS_ENABLED: Joi.boolean().default(false),
  ZALO_APP_ID: Joi.when("ZALO_ZNS_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  ZALO_APP_SECRET: Joi.when("ZALO_ZNS_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  ZALO_OA_ID: Joi.when("ZALO_ZNS_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  ZALO_TEMPLATE_MAP: Joi.when("ZALO_ZNS_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  STORAGE_ENABLED: Joi.boolean().default(false),
  SUPABASE_URL: Joi.when("STORAGE_ENABLED", { is: true, then: Joi.string().uri().required(), otherwise: Joi.string().uri().allow("").optional() }),
  SUPABASE_KEY: Joi.when("STORAGE_ENABLED", { is: true, then: Joi.string().required(), otherwise: Joi.string().allow("").optional() }),
  REPORT_EXPORT_DIR: Joi.string().optional(),
  REPORT_EXPORT_FONT_PATH: Joi.string().optional(),
  SEED_CREDENTIALS_FILE: Joi.string().default(".seed-credentials.json"),
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
  if (result.value.ZALO_ZNS_ENABLED) {
    try {
      const map: unknown = JSON.parse(String(result.value.ZALO_TEMPLATE_MAP));
      if (!map || Array.isArray(map) || typeof map !== "object" || Object.values(map).length === 0 ||
        Object.values(map).some((value) => typeof value !== "string" || !value.trim())) throw new Error("Danh sách mẫu không hợp lệ");
    } catch { throw new Error("Cấu hình ZALO_TEMPLATE_MAP phải là đối tượng JSON chứa mã mẫu hợp lệ"); }
  }
  if (result.value.CREDENTIALS_ENCRYPTION_KEY) {
    const key = String(result.value.CREDENTIALS_ENCRYPTION_KEY);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").length !== 32) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY phải là khóa base64 có độ dài giải mã 32 byte");
    }
  }
  return result.value as Record<string, unknown>;
}
