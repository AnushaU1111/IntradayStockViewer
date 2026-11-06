import { describe, expect, it } from "vitest";

import { sliceFixture, type FixtureFile } from "./sliceFixture.js";

const T0 = 1_790_000_000;

function fixture(timestamps: number[], extra: Record<string, (number | null)[]> = {}): FixtureFile {
  const series = (offset: number) => timestamps.map((_, i) => i + offset);
  return {
    capture: { symbol: "TEST" },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        chart: {
          error: null,
          result: [
            {
              meta: { symbol: "TEST" },
              timestamp: timestamps,
              indicators: {
                quote: [{ low: series(100), high: series(200), volume: series(300), ...extra }],
              },
            },
          ],
        },
      },
    },
  };
}

type Quote = Record<string, unknown[]>;
interface Body {
  chart: { result: { timestamp: number[]; indicators: { quote: Quote[] } }[] };
}

function bars(f: FixtureFile) {
  const r = (f.response.body as Body).chart.result[0];
  const q = r?.indicators.quote[0];
  return { t: r?.timestamp, low: q?.low, high: q?.high, volume: q?.volume, close: q?.close };
}

describe("sliceFixture", () => {
  const ts = [T0, T0 + 900, T0 + 1800, T0 + 2700];

  it("keeps bars with period1 <= t < period2", () => {
    const out = bars(sliceFixture(fixture(ts), T0 + 900, T0 + 2700));

    expect(out.t).toEqual([T0 + 900, T0 + 1800]);
  });

  it("cuts every quote array by the same indices", () => {
    const out = bars(sliceFixture(fixture(ts), T0 + 900, T0 + 2700));

    expect(out.low).toEqual([101, 102]);
    expect(out.high).toEqual([201, 202]);
    expect(out.volume).toEqual([301, 302]);
  });

  it("keeps nulls in place", () => {
    const f = fixture(ts, { close: [1, null, 3, null] });
    const q = (
      sliceFixture(f, T0, T0 + 2700).response.body as {
        chart: { result: { indicators: { quote: Record<string, unknown[]>[] } }[] };
      }
    ).chart.result[0]?.indicators.quote[0];

    expect(q?.close).toEqual([1, null, 3]);
  });

  it("does not modify the input", () => {
    const f = fixture(ts);
    const before = JSON.stringify(f);

    sliceFixture(f, T0 + 900, T0 + 1800);

    expect(JSON.stringify(f)).toBe(before);
  });

  it("returns non-chart responses unchanged", () => {
    const notFound: FixtureFile = {
      capture: {},
      response: {
        status: 404,
        headers: {},
        body: { chart: { result: null, error: { code: "Not Found" } } },
      },
    };
    const limited: FixtureFile = {
      capture: {},
      response: { status: 429, headers: {}, bodyText: "Too Many Requests" },
    };

    expect(sliceFixture(notFound, T0, T0 + 1)).toEqual(notFound);
    expect(sliceFixture(limited, T0, T0 + 1)).toEqual(limited);
  });

  it("rejects misaligned arrays instead of guessing", () => {
    const f = fixture(ts, { close: [1, 2, 3] });

    expect(() => sliceFixture(f, T0, T0 + 2700)).toThrow(/misaligned/);
  });

  it("rejects an inverted or non-integer window", () => {
    expect(() => sliceFixture(fixture(ts), T0 + 900, T0)).toThrow(RangeError);
    expect(() => sliceFixture(fixture(ts), T0 + 0.5, T0 + 900)).toThrow(RangeError);
  });
});
