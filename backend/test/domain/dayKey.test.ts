import { describe, expect, it } from "vitest";

import { dayKey, isValidTimeZone } from "../../src/domain/dayKey.js";

const at = (iso: string) => Date.parse(iso) / 1000;
const utcDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

describe("dayKey", () => {
  it("T1 uses the exchange-local date where it differs from UTC", () => {
    // 10:00 AEDT on Nov 6 is 23:00 UTC on Nov 5.
    const t = at("2026-11-05T23:00:00Z");

    expect(utcDate(t)).toBe("2026-11-05"); // guard: UTC grouping would be wrong
    expect(dayKey(t, "Australia/Sydney")).toBe("2026-11-06");
  });

  it("T2 follows DST instead of a fixed offset", () => {
    // 00:30 EDT on Oct 31 is 04:30 UTC. Yahoo's meta.gmtoffset after Nov 1 is -18000 (EST).
    const t = at("2026-10-31T04:30:00Z");
    const fixedOffsetDate = utcDate(t - 18_000);

    expect(fixedOffsetDate).toBe("2026-10-30"); // guard: a fixed offset would be wrong
    expect(dayKey(t, "America/New_York")).toBe("2026-10-31");
  });

  it("puts both 01:30 bars of the DST fall-back night on the same day", () => {
    expect(dayKey(at("2026-11-01T05:30:00Z"), "America/New_York")).toBe("2026-11-01"); // 01:30 EDT
    expect(dayKey(at("2026-11-01T06:30:00Z"), "America/New_York")).toBe("2026-11-01"); // 01:30 EST
  });

  it("pads months and days", () => {
    expect(dayKey(at("2026-01-05T15:00:00Z"), "America/New_York")).toBe("2026-01-05");
  });
});

describe("isValidTimeZone", () => {
  it.each(["America/New_York", "Australia/Sydney", "UTC", "Asia/Kolkata"])("accepts %s", (tz) => {
    expect(isValidTimeZone(tz)).toBe(true);
  });

  it.each(["", "Not/AZone", "EST5EDT/Nope", "America/New York"])("rejects %j", (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });
});
