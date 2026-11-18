import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

// JSDOM không đo bố cục, adapter chỉ lấp API observer cho thành phần Ant Design
// Không giả dữ liệu hoặc quyền, mỗi môi trường test có đối tượng riêng và được runner giải phóng
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    /** Nhận yêu cầu theo dõi nhưng không sinh callback kích thước giả trong JSDOM */
    observe() {}
    /** Bỏ yêu cầu theo dõi khi component tháo khỏi DOM, không có tài nguyên cần dọn */
    unobserve() {}
    /** Kết thúc vòng đời adapter, việc kiểm hiển thị thật thuộc browser test */
    disconnect() {}
  };
}

if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    return { promise, resolve, reject };
  };
}

if (typeof Set.prototype.intersection !== "function") {
  Set.prototype.intersection = function intersection(other) {
    return new Set([...this].filter((value) => other.has(value)));
  };
}

if (typeof Set.prototype.difference !== "function") {
  Set.prototype.difference = function difference(other) {
    return new Set([...this].filter((value) => !other.has(value)));
  };
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const { server } = await import("../mocks/server.js");

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
