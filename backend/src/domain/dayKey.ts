const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * Calendar date (YYYY-MM-DD) of a Unix-seconds instant in an IANA timezone.
 * Never uses UTC, the host zone or a fixed offset, so DST is handled per instant.
 */
export function dayKey(epochSeconds: number, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** True when the runtime recognizes the IANA zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone === "") return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}
