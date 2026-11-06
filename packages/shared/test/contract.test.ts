import { describe, expect, it } from "vitest";

import { ERROR_CODES, HEADERS, dailySummaryPath } from "../src/index.js";

describe("shared contract", () => {
  it("builds the versioned endpoint path and encodes the symbol", () => {
    expect(dailySummaryPath("TSLA")).toBe("/api/v1/stocks/TSLA/daily-summary");
    expect(dailySummaryPath("^GSPC")).toBe("/api/v1/stocks/%5EGSPC/daily-summary");
    expect(dailySummaryPath("M&M.NS")).toBe("/api/v1/stocks/M%26M.NS/daily-summary");
  });

  it("lists every problem code once", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toContain("INVALID_SYMBOL");
    expect(ERROR_CODES).toContain("UPSTREAM_BAD_RESPONSE");
  });

  it("names the metadata headers the UI reads", () => {
    expect(HEADERS).toEqual({
      exchangeTimezone: "X-Exchange-Timezone",
      currency: "X-Currency",
      partialDay: "X-Partial-Day",
      requestId: "X-Request-Id",
    });
  });
});
