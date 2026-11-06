import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { aggregateDaily } from "../../src/domain/aggregateDaily.js";
import { partialDay } from "../../src/domain/partialDay.js";
import type { InstrumentInfo, IntradayBar } from "../../src/domain/types.js";
import { sliceFixture, type FixtureFile } from "../support/sliceFixture.js";

interface Period {
  start: number;
  end: number;
}
interface ChartResult {
  meta: {
    exchangeTimezoneName: string;
    currency: string;
    instrumentType: "EQUITY";
    currentTradingPeriod: { regular: Period };
    tradingPeriods: Period[][];
  };
  timestamp: number[];
  indicators: {
    quote: { low: (number | null)[]; high: (number | null)[]; volume: (number | null)[] }[];
  };
}
interface Golden {
  clock: string;
  expectedHeaders: { "X-Partial-Day": string | null };
  expected: unknown[];
}

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));

const fixture = readJson("../fixtures/yahoo/TSLA.json") as FixtureFile;
const DAY = 86_400;

/**
 * What the provider would hand the domain for a given clock: the bars Yahoo returns
 * for period1 = clock - 35 days and period2 = clock, minus bars outside a regular
 * session (D-50). Mapped by hand here because the Yahoo mapper arrives in Phase 4;
 * the time cutoff stays at this boundary and never enters aggregateDaily.
 */
function providerView(clock: Date): { bars: IntradayBar[]; info: InstrumentInfo } {
  const now = Math.floor(clock.getTime() / 1000);
  const sliced = sliceFixture(fixture, now - 35 * DAY, now);
  const result = (sliced.response.body as { chart: { result: ChartResult[] } }).chart.result[0];
  if (result === undefined) throw new Error("fixture has no chart result");

  const quote = result.indicators.quote[0];
  if (quote === undefined) throw new Error("fixture has no quote");
  const periods = result.meta.tradingPeriods.flat();
  const inSession = (t: number) => periods.some((p) => p.start <= t && t < p.end);

  const bars = result.timestamp.flatMap((t, i) =>
    inSession(t)
      ? [
          {
            t,
            low: quote.low[i] ?? null,
            high: quote.high[i] ?? null,
            volume: quote.volume[i] ?? null,
          },
        ]
      : [],
  );
  const regular = result.meta.currentTradingPeriod.regular;
  return {
    bars,
    info: {
      timeZone: result.meta.exchangeTimezoneName,
      currency: result.meta.currency,
      instrumentType: result.meta.instrumentType,
      sessionStart: regular.start,
      sessionEnd: regular.end,
    },
  };
}

describe.each(["after-close", "in-session"])("A11 golden dataset: %s", (scenario) => {
  const golden = readJson(`../fixtures/golden/golden.${scenario}.json`) as Golden;
  const clock = new Date(golden.clock);
  const { bars, info } = providerView(clock);

  it("matches the independent Python oracle exactly", () => {
    const { days, diagnostics } = aggregateDaily(bars, info, clock);

    expect(days).toEqual(golden.expected);
    expect(diagnostics).toEqual({
      nullPrice: 0,
      inverted: 0,
      nonPositive: 0,
      badVolume: 0,
      duplicatesReplaced: 0,
    });
  });

  it("agrees with the oracle on the partial day", () => {
    expect(partialDay(clock, info)).toBe(golden.expectedHeaders["X-Partial-Day"]);
  });

  it("R3 serializes every average with at most 4 decimals", () => {
    const json = JSON.stringify(aggregateDaily(bars, info, clock).days);

    expect(json).not.toMatch(/\d\.\d{5,}/);
    expect(json).not.toMatch(/e[+-]/i);
  });
});
