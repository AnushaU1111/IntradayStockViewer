/**
 * Display formatting. `day` is an exchange-local calendar date string and is
 * only ever split, never parsed into a Date: new Date("2026-11-02") is midnight
 * UTC, which is Nov 1 in US timezones (spec 5.2). ESLint bans Date in app code.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDay {
  year: number;
  month: number; // 1-12
  date: number;
}

export function splitDay(day: string): CalendarDay | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const date = Number(d);
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  return { year, month, date };
}

/** Day of the week for a proleptic Gregorian date, by arithmetic alone (Sakamoto's method). */
export function weekdayIndex({ year, month, date }: CalendarDay): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const;
  const y = month < 3 ? year - 1 : year;
  const offset = offsets[month - 1] ?? 0;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offset + date) % 7;
}

/** "Nov 2". Falls back to the string as given if it is not a calendar date. */
export function formatDayShort(day: string): string {
  const parts = splitDay(day);
  return parts ? `${MONTHS[parts.month - 1] ?? ""} ${parts.date}` : day;
}

/** "Mon, Nov 2". */
export function formatDayLong(day: string): string {
  const parts = splitDay(day);
  return parts ? `${WEEKDAYS[weekdayIndex(parts)] ?? ""}, ${formatDayShort(day)}` : day;
}

/** "Oct 5 – Nov 5", with years only when the range crosses one. */
export function formatRange(first: string, last: string): string {
  const a = splitDay(first);
  const b = splitDay(last);
  if (a && b && a.year !== b.year) {
    return `${formatDayShort(first)}, ${a.year} – ${formatDayShort(last)}, ${b.year}`;
  }
  return first === last
    ? formatDayShort(first)
    : `${formatDayShort(first)} – ${formatDayShort(last)}`;
}

const PRICE = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const VOLUME = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** The API rounds to at most 4 decimals; padding to 4 keeps the column aligned without changing the value. */
export const formatPrice = (value: number): string => PRICE.format(value);
export const formatVolume = (value: number): string => VOLUME.format(value);
/** "12.3M", for the volume axis. */
export const formatCompact = (value: number): string => COMPACT.format(value);

/**
 * High minus low, computed in whole ten-thousandths so float subtraction
 * cannot leave a 5 in the fifth decimal and round the wrong way.
 */
export function spread(low: number, high: number): number {
  return (Math.round(high * 10_000) - Math.round(low * 10_000)) / 10_000;
}

/** "America/New_York" to "New York". The IANA name itself stays available to callers. */
export function zoneCity(timeZone: string): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replaceAll("_", " ");
}
