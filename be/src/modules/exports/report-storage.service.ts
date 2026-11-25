import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { lstat, mkdir, open, readFile, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Kho báo cáo private trên đĩa hoặc Supabase, không nhận key do client cung cấp.
 * Supabase giữ bytes qua restart; metadata và quyền tải ADMIN được giữ nguyên.
 */
@Injectable()
export class ReportStorageService {
  /** Kho remote dùng bucket private, không thay ACL từ request nghiệp vụ. */
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private get remoteEnabled(): boolean { return this.config.get<string>("REPORT_EXPORT_PROVIDER") === "supabase"; }

  /** Gọi kho private bằng key đã kiểm namespace; không tạo URL đọc công khai. */
  private async remote(key: string, method: string, bytes?: Buffer): Promise<Response> {
    const origin = this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
    const bucket = this.config.get<string>("REPORT_EXPORT_BUCKET") || this.config.get<string>("STORAGE_BUCKET") || "evidences";
    const secret = this.config.getOrThrow<string>("SUPABASE_KEY");
    const headers = { authorization: `Bearer ${secret}`, apikey: secret };
    const info = await fetch(`${origin}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!info.ok || (await info.json() as { public?: boolean }).public !== false) throw this.unavailable();
    const objectKey = `reports/${key}`;
    return fetch(`${origin}/storage/v1/object/${encodeURIComponent(bucket)}${method === "DELETE" ? "" : `/${objectKey}`}`, {
      method, headers: { ...headers, ...(bytes ? { "content-type": "application/octet-stream" } : {}), ...(method === "DELETE" ? { "content-type": "application/json" } : {}) },
      ...(method === "DELETE" ? { body: JSON.stringify({ prefixes: [objectKey] }) } : bytes ? { body: new Uint8Array(bytes) } : {}), signal: AbortSignal.timeout(15000),
    });
  }

  private unavailable(): ServiceUnavailableException { return new ServiceUnavailableException({ code: "STORAGE_UNAVAILABLE", message: "Kho báo cáo chưa sẵn sàng, vui lòng thử lại" }); }

  private async missingRemote(response: Response): Promise<boolean> {
    if (response.status === 404) return true;
    if (response.status !== 400) return false;
    try { const error = await response.clone().json() as { statusCode?: string | number; code?: string }; return String(error.statusCode) === "404" || ["NoSuchKey", "not_found"].includes(error.code ?? ""); }
    catch { return false; }
  }

  /** Chỉ chấp nhận đường dẫn tương đối theo mẫu server, hỗ trợ dấu phân cách của bản ghi Windows cũ */
  private path(key: string): { root: string; path: string } {
    const normalized = key.replaceAll("\\", "/");
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}-(summary-all-units|unit-appraisal-minutes)-\d+\.(xlsx|pdf|docx)$/.test(normalized)) throw this.missing();
    const root = resolve(this.config.get<string>("REPORT_EXPORT_DIR") || "./storage/report-exports");
    const path = resolve(root, normalized);
    const local = relative(root, path);
    if (!local || local.startsWith(`..${sep}`) || isAbsolute(local)) throw this.missing();
    return { root, path };
  }

  /** Trả lỗi chung cho tệp thiếu hoặc đường dẫn không hợp lệ, không tiết lộ bố cục filesystem */
  private missing() { return new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy tệp báo cáo" }); }

  /** Không theo symlink của thư mục kỳ hoặc file để không đọc ra ngoài vùng private
   * Thư mục gốc có thể chưa tồn tại khi ghi, còn khi đọc phải có đường dẫn thật nằm dưới gốc
   */
  private async verify(root: string, path: string, fileExists = false) {
    const folder = await lstat(dirname(path));
    if (!folder.isDirectory() || folder.isSymbolicLink()) throw this.missing();
    const actualRoot = await realpath(root);
    const actualFolder = await realpath(dirname(path));
    if (!actualFolder.startsWith(actualRoot + sep)) throw this.missing();
    if (fileExists) {
      const file = await lstat(path);
      if (!file.isFile() || file.isSymbolicLink()) throw this.missing();
    }
  }

  /** Lưu độc quyền trước metadata, đặt quyền riêng và chỉ bù xóa file do chính lần gọi tạo
   * Nếu namespace trùng thì không ghi đè hoặc xóa tệp sẵn có, lỗi được chuẩn hóa sang tiếng Việt
   */
  async put(key: string, bytes: Buffer): Promise<void> {
    const { root, path } = this.path(key);
    if (this.remoteEnabled) {
      if (!bytes.length || bytes.length > 32 * 1024 * 1024) throw this.unavailable();
      try { if (!(await this.remote(key.replaceAll("\\", "/"), "POST", bytes)).ok) throw this.unavailable(); }
      catch { throw this.unavailable(); }
      return;
    }
    let created = false;
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await this.verify(root, path);
      const handle = await open(path, "wx", 0o600);
      created = true;
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
    } catch {
      if (created) await rm(path, { force: true }).catch(() => undefined);
      throw new ServiceUnavailableException({ code: "STORAGE_UNAVAILABLE", message: "Không thể lưu tệp báo cáo, vui lòng thử lại" });
    }
  }

  /** Đọc tệp thường trong namespace hợp lệ, không để lỗi hệ điều hành đi ra API
   * Giới hạn 32 MiB bảo vệ đường đọc khi file trên đĩa bị thay đổi ngoài ứng dụng
   */
  async get(key: string): Promise<Buffer> {
    const { root, path } = this.path(key);
    if (this.remoteEnabled) {
      try {
        const response = await this.remote(key.replaceAll("\\", "/"), "GET");
        if (await this.missingRemote(response)) throw this.missing();
        if (!response.ok || !response.body) throw this.unavailable();
        const chunks: Uint8Array[] = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > 32 * 1024 * 1024) throw this.unavailable(); chunks.push(chunk); }
        return Buffer.concat(chunks);
      } catch (error) { if (error instanceof NotFoundException) throw error; throw this.unavailable(); }
    }
    try {
      await this.verify(root, path, true);
      if ((await lstat(path)).size > 32 * 1024 * 1024) throw this.missing();
      const bytes = await readFile(path);
      if (bytes.length > 32 * 1024 * 1024) throw this.missing();
      return bytes;
    } catch { throw this.missing(); }
  }

  /** Xóa bù idempotent sau lỗi giao dịch, lỗi xóa sẽ được bộ dọn mồ côi thử lại
   * Không đệ quy xóa thư mục và không xóa theo đường dẫn ngoài namespace
   */
  async remove(key: string): Promise<void> {
    const { root, path } = this.path(key);
    if (this.remoteEnabled) {
      try { const response = await this.remote(key.replaceAll("\\", "/"), "DELETE"); if (!response.ok && !await this.missingRemote(response)) throw this.unavailable(); }
      catch { throw this.unavailable(); }
      return;
    }
    try { await this.verify(root, path); await rm(path, { force: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ServiceUnavailableException({ code: "STORAGE_UNAVAILABLE", message: "Chưa thể dọn tệp báo cáo" }); }
  }

  /** Dọn tệp hơn 24 giờ không có metadata, callback phải xác minh tham chiếu DB trước khi xóa
   * DB hoặc filesystem lỗi thì giữ tệp để thử lại, không coi lỗi truy vấn là không có tham chiếu
   * Chỉ quét một cấp thư mục UUID và tệp đúng mẫu, không theo symlink hoặc đụng tệp khác
   */
  async cleanup(isReferenced: (key: string) => Promise<boolean>, now = new Date()): Promise<number> {
    if (this.remoteEnabled) return this.cleanupRemote(isReferenced, now);
    const root = resolve(this.config.get<string>("REPORT_EXPORT_DIR") || "./storage/report-exports");
    let removed = 0;
    try {
      for (const dir of await readdir(root, { withFileTypes: true })) {
        if (!dir.isDirectory() || !/^[0-9a-f-]{36}$/.test(dir.name)) continue;
        for (const file of await readdir(resolve(root, dir.name), { withFileTypes: true })) {
          if (!file.isFile()) continue;
          const key = `${dir.name}/${file.name}`;
          try {
            const target = this.path(key);
            if ((await lstat(target.path)).mtimeMs > now.getTime() - 86400000) continue;
            if (await isReferenced(key)) continue;
            await this.remove(key); removed += 1;
          } catch { /* Giữ nguyên tệp khi kiểm tham chiếu hoặc thao tác xóa chưa thành công, lần quét sau thử lại */ }
        }
      }
    } catch { /* Kho chưa có hoặc tạm không đọc được thì hoãn dọn, không làm lỗi luồng xuất báo cáo */ }
    return removed;
  }

  /** Quét riêng prefix reports, chỉ xóa tệp hơn 24h sau khi DB xác nhận không tham chiếu. */
  private async cleanupRemote(isReferenced: (key: string) => Promise<boolean>, now: Date): Promise<number> {
    let removed = 0;
    try {
      const origin = this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
      const bucket = this.config.get<string>("REPORT_EXPORT_BUCKET") || this.config.get<string>("STORAGE_BUCKET") || "evidences";
      const secret = this.config.getOrThrow<string>("SUPABASE_KEY");
      const headers = { authorization: `Bearer ${secret}`, apikey: secret, "content-type": "application/json" };
      const info = await fetch(`${origin}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers, signal: AbortSignal.timeout(10000) });
      if (!info.ok || (await info.json() as { public?: boolean }).public !== false) return 0;
      type Entry = { name: string; id: string | null; updated_at?: string; created_at?: string };
      const list = async (prefix: string): Promise<Entry[]> => {
        const entries: Entry[] = [];
        for (let offset = 0; ; offset += 1000) {
          const response = await fetch(`${origin}/storage/v1/object/list/${encodeURIComponent(bucket)}`, { method: "POST", headers, body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }), signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw this.unavailable();
          const page = await response.json() as Entry[];
          if (!Array.isArray(page)) throw this.unavailable();
          entries.push(...page);
          if (page.length < 1000) return entries;
        }
      };
      for (const folder of await list("reports")) {
        if (folder.id || !/^[0-9a-f-]{36}$/.test(folder.name)) continue;
        for (const file of await list(`reports/${folder.name}`)) {
          if (!file.id || (!file.updated_at && !file.created_at)) continue;
          const modified = new Date(file.updated_at || file.created_at!).getTime();
          if (!Number.isFinite(modified) || modified > now.getTime() - 86400000) continue;
          const key = `${folder.name}/${file.name}`;
          try { this.path(key); if (!await isReferenced(key)) { await this.remove(key); removed += 1; } }
          catch { /* Giữ file khi DB hoặc provider chưa thể xác minh. */ }
        }
      }
    } catch { /* Hoãn dọn khi chưa thể xác minh, không ảnh hưởng tạo/tải báo cáo. */ }
    return removed;
  }
}
