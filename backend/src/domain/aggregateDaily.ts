import type { DailySummary } from "@isv/shared";

import { strategyFor } from "./dayStrategies.js";
import { ProviderBadResponse } from "./errors.js";
import { mean4 } from "./rounding.js";
import type {
  AggregateDiagnostics,
  AggregateResult,
  InstrumentInfo,
  IntradayBar,
} from "./types.js";
import { tradingWindow } from "./window.js";

type Rejection = Exclude<keyof AggregateDiagnostics, "duplicatesReplaced">;

type Checked =
  | { readonly ok: true; readonly low: number; readonly high: number; readonly volume: number }
  | { readonly ok: false; readonly reason: Rejection };

/** Usable values of a bar, or why it cannot be used (DECISIONS D-14). Checked in this order. */
function check(bar: IntradayBar): Checked {
  const { low, high, volume } = bar;
  if (low === null || high === null || !Number.isFinite(low) || !Number.isFinite(high)) {
    return { ok: false, reason: "nullPrice" };
  }
  if (low <= 0 || high <= 0) return { ok: false, reason: "nonPositive" };
  if (low > high) return { ok: false, reason: "inverted" };
  if (volume === null) return { ok: true, low, high, volume: 0 };
  if (!Number.isSafeInteger(volume) || volume < 0) return { ok: false, reason: "badVolume" };
  return { ok: true, low, high, volume };
}

const sameValues = (a: IntradayBar, b: IntradayBar) =>
  Object.is(a.low, b.low) && Object.is(a.high, b.high) && Object.is(a.volume, b.volume);

/**
 * Groups 15-minute bars into exchange-local days inside the trailing one-month window
 * and returns per-day averages. Pure: no I/O, no logging, no clock of its own.
 */
export function aggregateDaily(
  bars: readonly IntradayBar[],
  info: InstrumentInfo,
  now: Date,
): AggregateResult {
  const diagnostics: AggregateDiagnostics = {
    nullPrice: 0,
    inverted: 0,
    nonPositive: 0,
    badVolume: 0,
    duplicatesReplaced: 0,
  };

  // Deduplicate by timestamp, keeping the last occurrence (DECISIONS D-16).
  const byTime = new Map<number, IntradayBar>();
  for (const bar of bars) {
    const seen = byTime.get(bar.t);
    if (seen !== undefined && !sameValues(seen, bar)) diagnostics.duplicatesReplaced += 1;
    byTime.set(bar.t, bar);
  }
  const ordered = [...byTime.values()].sort((a, b) => a.t - b.t);

  const window = tradingWindow(now, info.timeZone);
  const strategy = strategyFor(info.instrumentType);
  const groups = new Map<string, { lows: number[]; highs: number[]; volume: number }>();

  for (const bar of ordered) {
    const day = strategy.dayOf(bar.t, info.timeZone);
    if (day < window.from || day > window.to) continue;

    const checked = check(bar);
    if (!checked.ok) {
      diagnostics[checked.reason] += 1;
      continue;
    }

    let group = groups.get(day);
    if (group === undefined) {
      group = { lows: [], highs: [], volume: 0 };
      groups.set(day, group);
    }
    group.lows.push(checked.low);
    group.highs.push(checked.high);
    group.volume += checked.volume;
    if (!Number.isSafeInteger(group.volume)) {
      throw new ProviderBadResponse(`volume total for ${day} exceeds the safe integer range`);
    }
  }

  const days: DailySummary[] = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, g]) => ({
      day,
      lowAverage: mean4(g.lows),
      highAverage: mean4(g.highs),
      volume: g.volume,
    }));

  return { days, diagnostics };
}
