/** One trading day in the response body. The body is a bare array of these, oldest first. */
export interface DailySummary {
  /** Exchange-local calendar date, YYYY-MM-DD. */
  day: string;
  /** Mean of the day's 15-minute lows, rounded to at most 4 decimals. */
  lowAverage: number;
  /** Mean of the day's 15-minute highs, rounded to at most 4 decimals. */
  highAverage: number;
  /** Sum of the day's 15-minute volumes. */
  volume: number;
}

/** Metadata travels in headers so the body matches the brief's contract exactly. */
export const HEADERS = {
  exchangeTimezone: "X-Exchange-Timezone",
  currency: "X-Currency",
  partialDay: "X-Partial-Day",
  requestId: "X-Request-Id",
} as const;
