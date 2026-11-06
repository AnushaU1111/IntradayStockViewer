import { afterEach, describe, expect, it } from "vitest";

import {
  formatCompact,
  formatDayLong,
  formatDayShort,
  formatPrice,
  formatRange,
  formatVolume,
  spread,
  splitDay,
  weekdayIndex,
  zoneCity,
} from "../src/lib/format";

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe("F1: day strings render as the calendar date they name", () => {
  it.each(["Pacific/Honolulu", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati", "UTC"])(
    "2026-11-02 is Mon, Nov 2 with the host in %s",
    (tz) => {
      process.env.TZ = tz;
      expect(formatDayShort("2026-11-02")).toBe("Nov 2");
      expect(formatDayLong("2026-11-02")).toBe("Mon, Nov 2");
    },
  );

  it("the weekday arithmetic agrees with a UTC calendar for every day from 1999 to 2031", () => {
    // The oracle may use Date in UTC: only app code is barred from Date.
    for (let t = Date.UTC(1999, 0, 1); t <= Date.UTC(2031, 11, 31); t += 86_400_000) {
      const d = new Date(t);
      const parts = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate() };
      expect(weekdayIndex(parts)).toBe(d.getUTCDay());
    }
  });

  it("leaves anything that is not YYYY-MM-DD as it is", () => {
    expect(splitDay("2026-13-01")).toBeNull();
    expect(formatDayLong("not a day")).toBe("not a day");
  });

  it("formats ranges, adding years only across a year boundary", () => {
    expect(formatRange("2026-10-05", "2026-11-05")).toBe("Oct 5 – Nov 5");
    expect(formatRange("2025-12-29", "2026-01-28")).toBe("Dec 29, 2025 – Jan 28, 2026");
    expect(formatRange("2026-11-05", "2026-11-05")).toBe("Nov 5");
  });
});

describe("numbers", () => {
  it("pads prices to 4 decimals without changing them, with separators", () => {
    expect(formatPrice(344.522)).toBe("344.5220");
    expect(formatPrice(6812.3456)).toBe("6,812.3456");
    expect(formatPrice(0.0001)).toBe("0.0001");
  });

  it("groups volume and compacts it for the axis", () => {
    expect(formatVolume(218450835)).toBe("218,450,835");
    expect(formatCompact(12_345_678)).toBe("12.3M");
    expect(formatCompact(218_450_835)).toBe("218.5M");
  });

  it("computes the spread exactly in ten-thousandths", () => {
    expect(spread(385.5077, 388.5708)).toBe(3.0631);
    expect(spread(0.1, 0.3)).toBe(0.2); // 0.3 - 0.1 is 0.19999999999999998 in floats
    expect(formatPrice(spread(1.0001, 1.0002))).toBe("0.0001");
  });

  it("names the exchange city from the IANA zone", () => {
    expect(zoneCity("America/New_York")).toBe("New York");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneCity("UTC")).toBe("UTC");
  });
});
