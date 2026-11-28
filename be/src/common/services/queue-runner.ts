/** Mỗi lane chỉ claim ngay trước khi xử lý; hết ngân sách thì ngừng nhận việc mới.
 * Công việc đang gửi vẫn hoàn tất, tránh bỏ dở I/O và để lease hết hạn không cần thiết.
 */
export async function drainQueue<T>(options: {
  concurrency: number; budgetMs: number; limit: number;
  claim: () => Promise<T | null>; process: (claim: T) => Promise<void>;
  onError: () => void;
}): Promise<number> {
  const deadline = Date.now() + options.budgetMs;
  let reserved = 0;
  let processed = 0;
  await Promise.all(Array.from({ length: options.concurrency }, async () => {
    while (Date.now() < deadline && reserved < options.limit) {
      reserved += 1;
      let claim: T | null;
      try { claim = await options.claim(); } catch { options.onError(); return; }
      if (claim === null) return;
      try { await options.process(claim); } catch { options.onError(); }
      processed += 1;
    }
  }));
  return processed;
}
