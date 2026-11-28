import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Cache có giới hạn và gộp các lượt đọc cùng key; không giữ lỗi hoặc kéo dài TTL khi đọc. */
@Injectable()
export class RuntimeCache {
  private readonly entries = new Map<string, { expires: number; value: Promise<unknown> }>();
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  ttl(kind: "auth" | "dashboard"): number {
    return this.config.get<number>(kind === "auth" ? "AUTH_CACHE_TTL_MS" : "DASHBOARD_CACHE_TTL_MS") ?? (kind === "auth" ? 3000 : 5000);
  }

  async remember<T>(key: string, ttl: number, read: () => Promise<T>): Promise<T> {
    if (ttl <= 0) return read();
    const existing = this.entries.get(key);
    if (existing && existing.expires > Date.now()) return existing.value as Promise<T>;
    this.entries.delete(key);
    if (this.entries.size >= 5000) this.entries.delete(this.entries.keys().next().value!);
    const entry = { expires: Date.now() + ttl, value: Promise.resolve().then(read) };
    this.entries.set(key, entry);
    try { return await entry.value; }
    catch (error) { if (this.entries.get(key) === entry) this.entries.delete(key); throw error; }
  }

  invalidate(): void { this.entries.clear(); }
}
