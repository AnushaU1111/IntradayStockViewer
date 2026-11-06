import { describe, expect, it } from "vitest";

import { minusOneMonth, tradingWindow } from "../../src/domain/window.js";

const NY = "America/New_York";

describe("tradingWindow", () => {
  it("W1 covers today and the same date one month earlier", () => {
    expect(tradingWindow(new Date("2026-11-05T20:00:00Z"), NY)).toEqual({
      from: "2026-10-05",
      to: "2026-11-05",
    });
  });

  it("W4 takes today from the exchange zone, not UTC", () => {
    // 00:30 UTC on Nov 6 is still 19:30 on Nov 5 in New York.
    expect(tradingWindow(new Date("2026-11-06T00:30:00Z"), NY).to).toBe("2026-11-05");
  });
});

describe("minusOneMonth", () => {
  it("W2 clamps to the last day of a shorter month", () => {
    expect(minusOneMonth("2026-03-31")).toBe("2026-02-28");
    expect(minusOneMonth("2028-03-31")).toBe("2028-02-29");
    expect(minusOneMonth("2026-05-31")).toBe("2026-04-30");
  });

  it("rolls back across a year boundary", () => {
    expect(minusOneMonth("2027-01-15")).toBe("2026-12-15");
  });

  it("keeps the day when it exists", () => {
    expect(minusOneMonth("2026-11-05")).toBe("2026-10-05");
  });

  it("rejects malformed dates", () => {
    expect(() => minusOneMonth("2026-13-01")).toThrow(RangeError);
    expect(() => minusOneMonth("2026-11")).toThrow(RangeError);
  });
});
