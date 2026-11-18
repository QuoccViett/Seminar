import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { lstat, mkdir, open, readFile, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Kho báo cáo local private thật, không có tuyến static và không nhận key do client cung cấp
 * Namespace chỉ gồm UUID và tên do server sinh, bỏ qua symlink và file lạ khi dọn
 */
@Injectable()
export class ReportStorageService {
  /** Nhận thư mục riêng từ cấu hình, không đọc hoặc thay cấu hình kho minh chứng */
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

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
    try { await this.verify(root, path); await rm(path, { force: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ServiceUnavailableException({ code: "STORAGE_UNAVAILABLE", message: "Chưa thể dọn tệp báo cáo" }); }
  }

  /** Dọn tệp hơn 24 giờ không có metadata, callback phải xác minh tham chiếu DB trước khi xóa
   * DB hoặc filesystem lỗi thì giữ tệp để thử lại, không coi lỗi truy vấn là không có tham chiếu
   * Chỉ quét một cấp thư mục UUID và tệp đúng mẫu, không theo symlink hoặc đụng tệp khác
   */
  async cleanup(isReferenced: (key: string) => Promise<boolean>, now = new Date()): Promise<number> {
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
}
