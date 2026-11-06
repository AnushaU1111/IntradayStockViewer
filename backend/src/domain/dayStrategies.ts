import { dayKey } from "./dayKey.js";
import type { InstrumentType } from "./types.js";

/** Decides which trading day a bar belongs to. */
export interface DayStrategy {
  dayOf(epochSeconds: number, timeZone: string): string;
}

/** Equities, ETFs and indices trade one session per exchange-local calendar day. */
const exchangeCalendarDay: DayStrategy = { dayOf: dayKey };

// Crypto (UTC days) or futures (sessions crossing midnight) would add entries here
// without touching aggregateDaily (DECISIONS D-06).
const STRATEGIES: Readonly<Record<InstrumentType, DayStrategy>> = {
  EQUITY: exchangeCalendarDay,
  ETF: exchangeCalendarDay,
  INDEX: exchangeCalendarDay,
};

export function strategyFor(type: InstrumentType): DayStrategy {
  return STRATEGIES[type];
}
