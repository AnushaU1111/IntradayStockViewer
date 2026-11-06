import { describe, expect, it } from "vitest";

import { aggregateDaily } from "../../src/domain/aggregateDaily.js";
import { ProviderBadResponse } from "../../src/domain/errors.js";
import type { InstrumentInfo, IntradayBar } from "../../src/domain/types.js";

const NY: InstrumentInfo = {
  timeZone: "America/New_York",
  currency: "USD",
  instrumentType: "EQUITY",
  sessionStart: null,
  sessionEnd: null,
};
const NOW = new Date("2026-11-05T21:30:00Z"); // after the Nov 5 close; window Oct 5 to Nov 5

// 10:00 ET on a given date (EST after Nov 1, EDT before), plus n quarter hours.
const bar = (
  isoDay: string,
  n: number,
  low: number | null,
  high: number | null,
  volume: number | null,
): IntradayBar => {
  const offset = isoDay >= "2026-11-01" ? "-05:00" : "-04:00";
  return { t: Date.parse(`${isoDay}T10:00:00${offset}`) / 1000 + n * 900, low, high, volume };
};

const run = (bars: IntradayBar[], info = NY, now = NOW) => aggregateDaily(bars, info, now);

describe("aggregateDaily", () => {
  it("averages lows and highs and sums volume per exchange-local day", () => {
    const { days } = run([
      bar("2026-11-04", 0, 10, 12, 100),
      bar("2026-11-04", 1, 11, 15, 200),
      bar("2026-11-05", 0, 20, 21, 50),
    ]);

    expect(days).toEqual([
      { day: "2026-11-04", lowAverage: 10.5, highAverage: 13.5, volume: 300 },
      { day: "2026-11-05", lowAverage: 20, highAverage: 21, volume: 50 },
    ]);
  });

  it("returns no days and zero diagnostics for no bars", () => {
    expect(run([])).toEqual({
      days: [],
      diagnostics: {
        nullPrice: 0,
        inverted: 0,
        nonPositive: 0,
        badVolume: 0,
        duplicatesReplaced: 0,
      },
    });
  });

  it.each([
    ["before", 0, 1],
    ["after", 1, 0],
  ])(
    "A1 excludes a null-price bar from averages and volume when it comes %s the usable one",
    (_, rejectedSlot, usableSlot) => {
      // Both orders matter: a bug that adds rejected volume to an existing day only
      // shows up when the usable bar came first (found by mutation testing).
      const { days, diagnostics } = run([
        bar("2026-11-05", rejectedSlot, null, 12, 5000),
        bar("2026-11-05", usableSlot, 10, 14, 100),
      ]);

      expect(days).toEqual([{ day: "2026-11-05", lowAverage: 10, highAverage: 14, volume: 100 }]);
      expect(diagnostics.nullPrice).toBe(1);
    },
  );

  it("treats NaN and infinite prices like null", () => {
    const { days, diagnostics } = run([
      bar("2026-11-05", 0, Number.NaN, 12, 1),
      bar("2026-11-05", 1, 10, Number.POSITIVE_INFINITY, 1),
      bar("2026-11-05", 2, 10, 14, 1),
    ]);

    expect(days).toHaveLength(1);
    expect(diagnostics.nullPrice).toBe(2);
  });

  it("A2 omits a day whose bars are all unusable", () => {
    const { days } = run([bar("2026-11-04", 0, null, null, null), bar("2026-11-05", 0, 10, 11, 1)]);

    expect(days.map((d) => d.day)).toEqual(["2026-11-05"]);
  });

  it("A3 counts null volume as zero and keeps the prices", () => {
    const { days } = run([bar("2026-11-05", 0, 10, 12, null), bar("2026-11-05", 1, 12, 14, 7)]);

    expect(days).toEqual([{ day: "2026-11-05", lowAverage: 11, highAverage: 13, volume: 7 }]);
  });

  it("A4 excludes an inverted bar from averages and volume", () => {
    const { days, diagnostics } = run([
      bar("2026-11-05", 0, 10, 11, 1),
      bar("2026-11-05", 1, 15, 12, 900),
    ]);

    expect(days).toEqual([{ day: "2026-11-05", lowAverage: 10, highAverage: 11, volume: 1 }]);
    expect(diagnostics.inverted).toBe(1);
  });

  it("A5 excludes non-positive prices", () => {
    const { days, diagnostics } = run([
      bar("2026-11-05", 0, 0, 12, 1),
      bar("2026-11-05", 1, -1, 12, 1),
      bar("2026-11-05", 2, 10, 11, 1),
    ]);

    expect(days[0]?.lowAverage).toBe(10);
    expect(diagnostics.nonPositive).toBe(2);
  });

  it("A6 excludes negative, fractional and non-finite volume", () => {
    const { days, diagnostics } = run([
      bar("2026-11-05", 0, 10, 11, -10),
      bar("2026-11-05", 1, 10, 11, 12.5),
      bar("2026-11-05", 2, 10, 11, Number.NaN),
      bar("2026-11-05", 3, 20, 21, 4),
    ]);

    expect(days).toEqual([{ day: "2026-11-05", lowAverage: 20, highAverage: 21, volume: 4 }]);
    expect(diagnostics.badVolume).toBe(3);
  });

  it("A7 keeps one of identical duplicates and the last of differing ones", () => {
    const same = run([bar("2026-11-05", 0, 10, 12, 5), bar("2026-11-05", 0, 10, 12, 5)]);
    const differing = run([bar("2026-11-05", 0, 10, 12, 5), bar("2026-11-05", 0, 20, 22, 9)]);

    expect(same.days).toEqual([{ day: "2026-11-05", lowAverage: 10, highAverage: 12, volume: 5 }]);
    expect(same.diagnostics.duplicatesReplaced).toBe(0);
    expect(differing.days).toEqual([
      { day: "2026-11-05", lowAverage: 20, highAverage: 22, volume: 9 },
    ]);
    expect(differing.diagnostics.duplicatesReplaced).toBe(1);
  });

  it("A9 returns days in ascending order whatever the input order", () => {
    const { days } = run([
      bar("2026-11-05", 1, 3, 4, 1),
      bar("2026-10-20", 0, 1, 2, 1),
      bar("2026-11-05", 0, 5, 6, 1),
      bar("2026-11-02", 0, 7, 8, 1),
    ]);

    expect(days.map((d) => d.day)).toEqual(["2026-10-20", "2026-11-02", "2026-11-05"]);
  });

  it("A10 rejects a day whose volume total exceeds the safe integer range", () => {
    expect(() =>
      run([bar("2026-11-05", 0, 10, 11, Number.MAX_SAFE_INTEGER), bar("2026-11-05", 1, 10, 11, 1)]),
    ).toThrow(ProviderBadResponse);
  });

  it("W3 drops days outside the window and does not count them as unusable", () => {
    const { days, diagnostics } = run([
      bar("2026-10-02", 0, 1, 2, 1), // 35 days back: before Oct 5
      bar("2026-10-02", 1, null, 2, 1), // unusable, but out of window
      bar("2026-10-05", 0, 3, 4, 1), // first day of the window
      bar("2026-11-05", 0, 5, 6, 1), // today
    ]);

    expect(days.map((d) => d.day)).toEqual(["2026-10-05", "2026-11-05"]);
    expect(diagnostics.nullPrice).toBe(0);
  });

  it("groups by the exchange's local date, not UTC", () => {
    const sydney: InstrumentInfo = { ...NY, timeZone: "Australia/Sydney", currency: "AUD" };
    const t = Date.parse("2026-11-04T23:00:00Z") / 1000; // 10:00 AEDT on Nov 5

    const { days } = run(
      [{ t, low: 1, high: 2, volume: 1 }],
      sydney,
      new Date("2026-11-05T05:00:00Z"),
    );

    expect(days.map((d) => d.day)).toEqual(["2026-11-05"]);
  });

  it("does not modify the input bars", () => {
    const bars = [bar("2026-11-05", 1, 1, 2, 1), bar("2026-11-05", 0, 3, 4, 1)];
    const before = JSON.stringify(bars);

    run(bars);

    expect(JSON.stringify(bars)).toBe(before);
  });
});
