import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { MAX_FILE_BYTES } from "./file-policy.js";

/** Cổng storage riêng tư dùng chung cho kho local thật và Supabase, không cung cấp đường đọc theo key
 * Tất cả key do service tạo; lỗi filesystem/provider không được đưa ra API hoặc log
 */
@Injectable()
export class StorageProvider {
  /** Nhận cấu hình đã validate, mặc định storage tắt và không kết nối provider ngoài */
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  /** Báo khả dụng theo cờ, tránh giả thành công khi môi trường chưa cấu hình storage */
  assertEnabled(): void {
    if (!this.config.get<boolean>("STORAGE_ENABLED")) throw this.unavailable();
  }

  /** Tạo lỗi cố định, bỏ mọi chi tiết có thể chứa service key, URL hoặc đường dẫn máy chủ */
  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({ code: "STORAGE_UNAVAILABLE", message: "Kho tệp chưa sẵn sàng, vui lòng thử lại sau" });
  }

  /** Chỉ chấp nhận namespace và UUID do server cấp, không cho vượt thư mục gốc hoặc chọn key tùy ý */
  private localPath(key: string): string {
    if (!/^(pending|final)\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw this.unavailable();
    const root = resolve(this.config.get<string>("STORAGE_LOCAL_DIR") ?? ".private-storage");
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw this.unavailable();
    return path;
  }

  /** Gọi REST Supabase có timeout và kiểm bucket private trước mỗi thao tác
   * Không tự tạo bucket hoặc đổi ACL vì quyền hạ tầng phải được cấu hình riêng
   */
  private async remote(key: string, method: string, bytes?: Buffer, mimeType?: string): Promise<Response> {
    const origin = this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
    const bucket = this.config.getOrThrow<string>("STORAGE_BUCKET");
    const secret = this.config.getOrThrow<string>("SUPABASE_KEY");
    const headers = { authorization: `Bearer ${secret}`, apikey: secret };
    const bucketResponse = await fetch(`${origin}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!bucketResponse.ok || (await bucketResponse.json() as { public?: boolean }).public !== false) throw this.unavailable();
    return fetch(`${origin}/storage/v1/object/${encodeURIComponent(bucket)}${method === "DELETE" ? "" : `/${key}`}`, {
      method, headers: { ...headers, ...(mimeType ? { "content-type": mimeType, "x-upsert": "true" } : {}), ...(method === "DELETE" ? { "content-type": "application/json" } : {}) },
      ...(method === "DELETE" ? { body: JSON.stringify({ prefixes: [key] }) } : bytes ? { body: new Uint8Array(bytes) } : {}), signal: AbortSignal.timeout(15000),
    });
  }

  /** Nhận diện riêng lỗi object không tồn tại của REST Supabase, kể cả HTTP 400 bọc mã 404
   * Chỉ đọc mã provider đã biết để xử lý idempotent, không trả body hoặc thông điệp ra ngoài
   */
  private async missingRemote(response: Response): Promise<boolean> {
    if (response.status === 404) return true;
    if (response.status !== 400) return false;
    try {
      const error = await response.clone().json() as { statusCode?: string | number; code?: string };
      return String(error.statusCode) === "404" || ["NoSuchKey", "not_found"].includes(error.code ?? "");
    } catch { return false; }
  }

  /** Lưu bytes đã kiểm vào namespace nội bộ, caller giữ khóa hồ sơ để serialize upload/confirm/cleanup
   * Retry được ghi đè chỉ trong vùng chờ, final chỉ được ghi từ cùng phiên immutable trước xác nhận
   */
  async put(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    this.assertEnabled();
    try {
      const path = this.localPath(key);
      if (this.config.get<string>("STORAGE_PROVIDER") === "supabase") {
        if (!(await this.remote(key, "POST", bytes, mimeType)).ok) throw this.unavailable();
      } else { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, bytes, { mode: 0o600 }); }
    } catch { throw this.unavailable(); }
  }

  /** Đọc tối đa giới hạn một tệp từ kho private, trả null cho object chưa có
   * Không tin Content-Length provider, kiểm cả số byte đọc để không nhận object quá quota
   */
  async get(key: string): Promise<Buffer | null> {
    this.assertEnabled();
    try {
      const path = this.localPath(key);
      let bytes: Buffer;
      if (this.config.get<string>("STORAGE_PROVIDER") === "supabase") {
        const response = await this.remote(key, "GET");
        if (await this.missingRemote(response)) return null;
        if (!response.ok || !response.body) throw this.unavailable();
        const chunks: Uint8Array[] = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > MAX_FILE_BYTES) throw this.unavailable(); chunks.push(chunk); }
        bytes = Buffer.concat(chunks);
      } else {
        if ((await stat(path)).size > MAX_FILE_BYTES) throw this.unavailable();
        bytes = await readFile(path);
      }
      if (bytes.length > MAX_FILE_BYTES) throw this.unavailable();
      return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw this.unavailable();
    }
  }

  /** Xóa idempotent sau commit hoặc cleanup, object không tồn tại coi như đã dọn
   * Nếu provider hỏng thì ném lỗi an toàn để caller giữ tombstone và retry lần sau
   */
  async remove(key: string): Promise<void> {
    this.assertEnabled();
    try {
      const path = this.localPath(key);
      if (this.config.get<string>("STORAGE_PROVIDER") === "supabase") {
        const response = await this.remote(key, "DELETE");
        if (!response.ok && !await this.missingRemote(response)) throw this.unavailable();
      } else await unlink(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw this.unavailable(); }
  }
}
