import { dayKey } from "./dayKey.js";

/** Inclusive range of exchange-local dates, YYYY-MM-DD. */
export interface DateWindow {
  from: string;
  to: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The same day one calendar month earlier, clamped to that month's last day. */
export function minusOneMonth(isoDate: string): string {
  const m = ISO_DATE.exec(isoDate);
  const year = Number(m?.[1]);
  const month = Number(m?.[2]);
  const day = Number(m?.[3]);
  if (m === null || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError(`not a calendar date: ${isoDate}`);
  }

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(prevYear, 4)}-${pad(prevMonth)}-${pad(Math.min(day, lastDay))}`;
}

/** Today in the exchange zone, back to the same date one month earlier (DECISIONS D-09). */
export function tradingWindow(now: Date, timeZone: string): DateWindow {
  const to = dayKey(Math.floor(now.getTime() / 1000), timeZone);
  return { from: minusOneMonth(to), to };
}
