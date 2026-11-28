import { afterEach, expect, test, vi } from "vitest";
import { startVisiblePolling } from "./visiblePolling";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("tab ẩn ngừng poll, quay lại chỉ chạy một lượt và lỗi được backoff", async () => {
  vi.useFakeTimers();
  let visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const read = vi.fn().mockResolvedValue(true);
  const stop = startVisiblePolling(read, { intervalMs: 1000 });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    visibility = "hidden";
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(1);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    read.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(4);
  } finally { stop(); }
});
