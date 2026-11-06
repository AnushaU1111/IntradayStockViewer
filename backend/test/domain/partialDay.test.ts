import { describe, expect, it } from "vitest";

import { partialDay } from "../../src/domain/partialDay.js";

const session = {
  timeZone: "America/New_York",
  sessionStart: Date.parse("2026-11-05T14:30:00Z") / 1000,
  sessionEnd: Date.parse("2026-11-05T21:00:00Z") / 1000,
};

describe("P1 partialDay", () => {
  it.each([
    ["2026-11-05T14:00:00Z", null], // before the open
    ["2026-11-05T14:30:00Z", "2026-11-05"], // at the open
    ["2026-11-05T18:00:00Z", "2026-11-05"], // mid-session
    ["2026-11-05T21:00:00Z", null], // at the close (end is exclusive)
    ["2026-11-05T21:30:00Z", null], // after the close
  ])("at %s returns %j", (iso, want) => {
    expect(partialDay(new Date(iso), session)).toBe(want);
  });

  it("returns null when the session is unknown", () => {
    const now = new Date("2026-11-05T18:00:00Z");

    expect(partialDay(now, { ...session, sessionStart: null })).toBeNull();
    expect(partialDay(now, { ...session, sessionEnd: null })).toBeNull();
  });
});
