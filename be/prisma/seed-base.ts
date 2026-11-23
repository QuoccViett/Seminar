import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

/** Chỉ tạo Admin nếu chưa tồn tại; chạy lại không đổi mật khẩu, quyền hoặc trạng thái */
const password = process.env.SEED_ADMIN_PASSWORD;
if (!password || /CHANGE_ME|replace/i.test(password)) throw new Error("Cần SEED_ADMIN_PASSWORD riêng trước khi seed base");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!existing) await prisma.user.create({ data: { id: randomUUID(), username, fullName: "Quản trị hệ thống", email: process.env.SEED_ADMIN_EMAIL ?? null, role: "ADMIN", passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, createdAt: new Date(), updatedAt: new Date() } });
  console.info(existing ? "Quản trị viên đã tồn tại, giữ nguyên dữ liệu" : "Đã tạo quản trị viên; cần đổi mật khẩu lần đầu");
} catch { console.error("Không thể tạo dữ liệu nền, vui lòng kiểm tra cấu hình và DB"); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
