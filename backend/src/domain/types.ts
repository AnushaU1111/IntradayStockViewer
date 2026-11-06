import type { DailySummary } from "@isv/shared";

/** Instrument types in scope for the MVP (DECISIONS D-06). */
export type InstrumentType = "EQUITY" | "ETF" | "INDEX";

/**
 * One 15-minute bar as the provider received it. Values are not yet trusted:
 * aggregateDaily decides which bars are usable.
 */
export interface IntradayBar {
  /** Bar start, Unix seconds. */
  t: number;
  low: number | null;
  high: number | null;
  volume: number | null;
}

/** What the domain needs to know about the instrument behind a set of bars. */
export interface InstrumentInfo {
  /** IANA zone of the exchange; already validated by the provider. */
  timeZone: string;
  currency: string | null;
  instrumentType: InstrumentType;
  /** Current regular session in Unix seconds, when the provider reports it. */
  sessionStart: number | null;
  sessionEnd: number | null;
}

/** How many in-window bars were left out, and why. */
export interface AggregateDiagnostics {
  nullPrice: number;
  inverted: number;
  nonPositive: number;
  badVolume: number;
  duplicatesReplaced: number;
}

export interface AggregateResult {
  days: DailySummary[];
  diagnostics: AggregateDiagnostics;
}
