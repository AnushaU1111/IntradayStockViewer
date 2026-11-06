import { describe, expect, it } from "vitest";

import {
  IntradayUnavailable,
  ProviderBadResponse,
  ProviderRejected,
  SymbolNotFound,
  UnsupportedInstrument,
} from "../../src/domain/errors.js";
import { mapYahooChart } from "../../src/providers/yahoo/yahooMapper.js";
import { fixtureBody } from "../support/fixtures.js";

type Json = Record<string, unknown>;
const first = (list: unknown): Json => {
  const item = (list as Json[])[0];
  if (item === undefined) throw new Error("expected a non-empty array");
  return item;
};
const result = (body: Json) => first((body.chart as Json).result);
const meta = (body: Json) => result(body).meta as Json;
const quote = (body: Json) => first((result(body).indicators as Json).quote);

// A minimal valid chart with two bars inside one regular session.
function synthetic(overrides: { meta?: Json; result?: Json } = {}): Json {
  const start = Date.parse("2026-11-05T14:30:00Z") / 1000;
  const end = start + 6.5 * 3600;
  return {
    chart: {
      error: null,
      result: [
        {
          meta: {
            instrumentType: "EQUITY",
            dataGranularity: "15m",
            exchangeTimezoneName: "America/New_York",
            currency: "USD",
            currentTradingPeriod: { regular: { start, end } },
            tradingPeriods: [[{ start, end }]],
            ...overrides.meta,
          },
          timestamp: [start, start + 900],
          indicators: { quote: [{ low: [10, 11], high: [12, 13], volume: [100, 200] }] },
          ...overrides.result,
        },
      ],
    },
  };
}

describe("mapYahooChart with captured fixtures", () => {
  it("maps TSLA, dropping only the closing-price stub outside the session (H9d)", () => {
    const data = mapYahooChart(fixtureBody("TSLA"));

    expect(data.bars).toHaveLength(650);
    expect(data.outsideSession).toBe(1);
    expect(data.bars.at(-1)?.t).toBe(Date.parse("2026-11-05T20:45:00Z") / 1000);
    expect(data.info).toEqual({
      timeZone: "America/New_York",
      currency: "USD",
      instrumentType: "EQUITY",
      sessionStart: Date.parse("2026-11-05T14:30:00Z") / 1000,
      sessionEnd: Date.parse("2026-11-05T21:00:00Z") / 1000,
    });
  });

  it("maps an index and keeps its reported volume", () => {
    const data = mapYahooChart(fixtureBody("GSPC"));

    expect(data.info.instrumentType).toBe("INDEX");
    expect(data.bars[0]?.volume).toBeGreaterThan(0);
  });

  it("H3 rejects crypto as out of scope", () => {
    expect(() => mapYahooChart(fixtureBody("BTC-USD"))).toThrow(UnsupportedInstrument);
  });

  it("H4 reports no intraday data for a mutual fund with daily granularity", () => {
    // Checked before instrument scope, so the user learns there is no 15m data.
    expect(() => mapYahooChart(fixtureBody("VFIAX"))).toThrow(IntradayUnavailable);
  });

  it("H1 maps Yahoo's not-found body", () => {
    expect(() => mapYahooChart(fixtureBody("unknown-symbol"))).toThrow(SymbolNotFound);
  });
});

describe("mapYahooChart error handling", () => {
  it("H2 treats a Not Found error inside an HTTP 200 as not found", () => {
    const body = {
      chart: { result: null, error: { code: "Not Found", description: "No data found" } },
    };

    expect(() => mapYahooChart(body)).toThrow(SymbolNotFound);
  });

  it("treats any other chart.error as a rejected request", () => {
    const body = {
      chart: { result: null, error: { code: "Bad Request", description: "Invalid input" } },
    };

    expect(() => mapYahooChart(body)).toThrow(ProviderRejected);
  });

  it("H4b accepts a payload without session or currency metadata", () => {
    const body = synthetic();
    delete meta(body).currentTradingPeriod;
    delete meta(body).currency;

    const data = mapYahooChart(body);

    expect(data.bars).toHaveLength(2);
    expect(data.info).toMatchObject({ currency: null, sessionStart: null, sessionEnd: null });
  });

  it("treats malformed display-only metadata as absent", () => {
    const data = mapYahooChart(
      synthetic({ meta: { currentTradingPeriod: { regular: { start: "x" } }, currency: 7 } }),
    );

    expect(data.info).toMatchObject({ currency: null, sessionStart: null, sessionEnd: null });
  });

  it("H9b returns no bars for a valid empty result", () => {
    const body = synthetic({ result: { indicators: { quote: [{}] } } });
    delete result(body).timestamp;

    expect(mapYahooChart(body).bars).toEqual([]);
  });

  it("T3 rejects a missing or unknown timezone", () => {
    const missing = synthetic();
    delete meta(missing).exchangeTimezoneName;

    expect(() => mapYahooChart(missing)).toThrow(ProviderBadResponse);
    expect(() => mapYahooChart(synthetic({ meta: { exchangeTimezoneName: "Not/AZone" } }))).toThrow(
      ProviderBadResponse,
    );
  });

  it("requires tradingPeriods when bars exist (D-50)", () => {
    const body = synthetic();
    delete meta(body).tradingPeriods;

    expect(() => mapYahooChart(body)).toThrow(ProviderBadResponse);
  });

  describe("H9 malformed payloads never become an empty result", () => {
    it.each<[string, (body: Json) => void]>([
      ["numbers as strings", (b) => (quote(b).low = ["10", "11"])],
      ["timestamps with no indicators", (b) => delete result(b).indicators],
      ["timestamps with an empty quote", (b) => ((result(b).indicators as Json).quote = [{}])],
      ["a quote array shorter than timestamp", (b) => (quote(b).high = [12])],
      ["no result and no error", (b) => ((b.chart as Json).result = null)],
      ["no chart at all", (b) => delete b.chart],
    ])("%s", (_, corrupt) => {
      const body = synthetic();
      corrupt(body);

      expect(() => mapYahooChart(body)).toThrow(ProviderBadResponse);
    });

    it("rejects a body that is not an object", () => {
      expect(() => mapYahooChart("Too Many Requests")).toThrow(ProviderBadResponse);
      expect(() => mapYahooChart(null)).toThrow(ProviderBadResponse);
    });
  });

  it.each([1.5, -1, Number.NaN, "1730000000", 9e15, null])(
    "H9c rejects the whole payload when one timestamp is %j",
    (bad) => {
      const body = synthetic();
      (result(body).timestamp as unknown[])[1] = bad;

      expect(() => mapYahooChart(body)).toThrow(ProviderBadResponse);
    },
  );
});
