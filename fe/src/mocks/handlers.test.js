// @vitest-environment node

import { describe, expect, it } from "vitest";

/** Dữ liệu mock phát triển phải giữ phase kỹ thuật giống backend, không thay chứng cứ API thật */
describe("evaluation-period API mock", () => {
  it("returns paginated camelCase evaluation periods and applies filters", async () => {
    const response = await fetch(
      "http://localhost/api/v1/evaluation-periods?year=2026&page=1&pageSize=10",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      items: [
        {
          id: "period-2026",
          year: 2026,
          phase: "SELF_EVAL",
          maxTotalScore: 300,
        },
      ],
    });
  });
});
