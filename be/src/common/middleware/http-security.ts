import { createHash } from "node:crypto";
import type { Express, RequestHandler } from "express";
import { rateLimit, type Options } from "express-rate-limit";

type HttpSecurityOptions = { trustProxy: string | false; rateLimit: boolean; windowMs?: number; loginLimit?: number };

/** Một process phục vụ một replica; khi tăng replica phải thay bằng store giới hạn dùng chung */
export function installHttpSecurity(server: Express, options: HttpSecurityOptions): void {
  server.disable("x-powered-by");
  server.set("trust proxy", options.trustProxy);
  server.use((req, res, next) => {
    if ((req.method === "POST" && req.path === "/api/v1/users") || /\/auth(?:\/|$)|\/onboarding(?:\/|$)|\/credential-deliveries(?:\/|$)|\/reset-password$|\/users\/import(?:\/|$)/.test(req.path)) res.setHeader("Cache-Control", "no-store");
    next();
  });
  if (!options.rateLimit) return;
  const limiter = (limit: number, keyGenerator?: Options["keyGenerator"]): RequestHandler => rateLimit({
    windowMs: options.windowMs ?? 60_000, limit, standardHeaders: "draft-8", legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res) => res.status(429).json({ statusCode: 429, code: "RATE_LIMITED", message: "Bạn thao tác quá nhanh. Vui lòng thử lại sau thời gian chờ.", details: [] }),
  });
  server.use("/api/v1/auth/login", limiter((options.loginLimit ?? 5) * 4), limiter(options.loginLimit ?? 5, (req) =>
    createHash("sha256").update(String(req.body?.username ?? "").trim().toLowerCase()).digest("hex")));
  server.use("/api/v1/auth/refresh", limiter(30));
  server.use("/api/v1/onboarding", limiter(10));
  server.use("/api/v1/users/import", limiter(20));
  const upload = limiter(60); const retry = limiter(10);
  server.use((req, res, next) => {
    if ((/\/evidences(?:\/|$)|^\/api\/v1\/storage\/uploads\//.test(req.path)) && req.method !== "GET") return upload(req, res, next);
    if (/\/credential-deliveries\/retry$|\/reset-password$/.test(req.path)) return retry(req, res, next);
    next();
  });
}
