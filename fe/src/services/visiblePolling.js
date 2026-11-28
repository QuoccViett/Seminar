/** Chỉ poll tab đang hiện, gộp focus/visibility và giãn nhịp khi lỗi.
 * task trả false khi đã tự hiển thị lỗi; reject cũng được xử lý như lỗi mạng.
 */
export function startVisiblePolling(task, { intervalMs = 30000, immediate = true, events = [] } = {}) {
  let stopped = false;
  let busy = false;
  let failures = 0;
  let retryAt = 0;
  let finishedAt = 0;
  async function tick(force = false) {
    if (stopped || busy || document.visibilityState === "hidden") return;
    if (!force && Date.now() < retryAt) return;
    if (force && Date.now() - finishedAt < 1000) return;
    busy = true;
    try {
      if (await task() === false) throw new Error("poll failed");
      failures = 0;
      retryAt = 0;
    } catch {
      failures = Math.min(4, failures + 1);
      retryAt = Date.now() + Math.min(120000, intervalMs * 2 ** failures);
    } finally { busy = false; finishedAt = Date.now(); }
  }
  const timer = setInterval(() => { void tick(); }, intervalMs);
  const onVisible = () => { void tick(true); };
  const onChanged = () => { finishedAt = 0; void tick(true); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  for (const event of events) window.addEventListener(event, onChanged);
  if (immediate) void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    for (const event of events) window.removeEventListener(event, onChanged);
  };
}
