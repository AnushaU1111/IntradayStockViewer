const DELAY_SECONDS = /^\d+$/;
// RFC 9110 IMF-fixdate, e.g. "Thu, 05 Nov 2026 21:32:00 GMT". Date.parse alone is too
// lenient (it accepts "-5" as a year), so the format is checked first.
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Seconds to wait from a Retry-After header, or null when it is missing or unusable.
 * A date in the past means "now" (0).
 */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  const value = header?.trim() ?? "";
  if (DELAY_SECONDS.test(value)) return Number(value);
  if (HTTP_DATE.test(value)) {
    const at = Date.parse(value);
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - nowMs) / 1000));
  }
  return null;
}
