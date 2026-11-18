import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    // Worker VM tái sử dụng luồng chạy nhưng mỗi tệp vẫn có ngữ cảnh JSDOM cách ly riêng
    // Chạy một worker, tái tạo khi vượt 256 MB để máy demo không tạo nhiều process nặng cùng lúc
    // Ngân sách render 60 giây giữ nguyên mọi assertion quyền và API, không thay timeout nghiệp vụ backend
    pool: "vmThreads",
    isolate: true,
    vmMemoryLimit: "256MB",
    maxWorkers: 1,
    testTimeout: 60000,
    // Entry node của icon bọc CommonJS rồi require màu ESM, worker VM cần dùng entry es như trình duyệt
    // Alias chỉ khớp import gốc trong test, giữ nguyên các import sâu của Ant và không thay thư viện bằng mock
    alias: [{ find: /^@ant-design\/icons$/, replacement: fileURLToPath(new URL("./node_modules/@ant-design/icons/es/index.js", import.meta.url)) }],
    server: { deps: { inline: [/@ant-design\/(icons|colors)/] } },
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    restoreMocks: true,
  },
});
