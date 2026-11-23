import "dotenv/config";
import { Buffer } from "node:buffer";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import { ConfigService } from "@nestjs/config";
import { StorageProvider } from "../dist/modules/evidences/storage.provider.js";

const bucket = process.env.VC10_SUPABASE_BUCKET;
if (!bucket || !process.env.SUPABASE_KEY || !process.env.SUPABASE_URL || /your-project|example/.test(process.env.SUPABASE_URL)) throw new Error("Cần project thật, service key BE và VC10_SUPABASE_BUCKET được chỉ định riêng cho kiểm thử");
const storage = new StorageProvider(new ConfigService({ STORAGE_ENABLED: true, STORAGE_PROVIDER: "supabase", STORAGE_BUCKET: bucket, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_KEY: process.env.SUPABASE_KEY }));
const key = `pending/${randomUUID()}/${randomUUID()}`;
const bytes = Buffer.from("%PDF-1.4\n% Seminar VC10 provider integration fixture\n%%EOF\n");
const report = { checkedAt: new Date().toISOString(), bucket, privateBucketChecked: false, bytesMatch: false, removed: false };
try {
  await storage.put(key, bytes, "application/pdf"); report.privateBucketChecked = true;
  const downloaded = await storage.get(key);
  if (!downloaded?.equals(bytes)) throw new Error("Bytes tải về khác bản gốc");
  report.bytesMatch = true;
  report.sha256 = createHash("sha256").update(bytes).digest("hex");
} catch { console.error("Tích hợp Supabase thật chưa đạt; kiểm bucket private/quyền/kết nối, không in secret"); process.exitCode = 1; }
finally {
  try { await storage.remove(key); report.removed = await storage.get(key) === null; } catch { process.exitCode = 1; }
  await mkdir(".tmp", { recursive: true }); await writeFile(".tmp/vc10-supabase-real.json", JSON.stringify(report, null, 2));
}
if (!process.exitCode) console.log("Đã kiểm bucket private thật, upload/download khớp bytes và dọn đúng object kiểm thử");
