import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Thư mục thử chứa log, coverage và tài nguyên sinh tự động, không phải source cần lint
    ignores: ["dist/**", "src/generated/**", ".tmp/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: {
        fetch: "readonly",
        process: "readonly",
      },
    },
  },
  {
    // Các tên này chỉ xuất hiện bên trong callback Playwright chạy ở trình duyệt thật
    // Giới hạn vào browser harness để không cấp nhầm global trình duyệt cho source backend
    files: ["test/browser/*.mjs"],
    languageOptions: { globals: { window: "readonly", document: "readonly", location: "readonly", sessionStorage: "readonly", fetch: "readonly", DataTransfer: "readonly", File: "readonly", Event: "readonly", innerWidth: "readonly" } },
  },
);
