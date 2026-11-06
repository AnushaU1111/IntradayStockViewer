import { describe, expect, it } from "vitest";

/**
 * Guards the CI timezone matrix: if TZ is set, the runtime must actually use it.
 * Without this, a matrix that sets TZ but never reaches Node would pass silently,
 * and the timezone tests in Phase 3 would prove nothing.
 */
describe("host timezone", () => {
  const requested = process.env.TZ;

  it.runIf(requested !== undefined && requested !== "")(
    "matches the TZ environment variable",
    () => {
      const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const aliases = requested === "UTC" ? ["UTC", "Etc/UTC"] : [requested];

      expect(aliases).toContain(resolved);
    },
  );
});
