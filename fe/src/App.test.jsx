import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App.jsx";

describe("App", () => {
  /** Chờ mã trang tải theo tuyến, người chưa có phiên phải thấy form đăng nhập thật */
  it("hiển thị trang đăng nhập khi chưa có phiên", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Đăng Nhập Hệ Thống" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Đăng nhập" }),
    ).toBeInTheDocument();
  });
});
