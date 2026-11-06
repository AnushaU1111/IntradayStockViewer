import { describe, expect, it, vi } from "vitest";

import {
  IntradayUnavailable,
  ProviderBadResponse,
  ProviderRateLimited,
  ProviderTimeout,
  ProviderUnavailable,
  SymbolNotFound,
  UnsupportedInstrument,
  type DomainError,
} from "../../src/domain/errors.js";
import {
  createCachedProvider,
  type CachedProviderOptions,
} from "../../src/providers/cachedProvider.js";
import type { ProviderData } from "../../src/providers/marketDataProvider.js";

const data = (symbol: string): ProviderData => ({
  bars: [{ t: 1, low: 1, high: 2, volume: 3 }],
  outsideSession: 0,
  info: {
    timeZone: symbol,
    currency: null,
    instrumentType: "EQUITY",
    sessionStart: null,
    sessionEnd: null,
  },
});

function setup(
  outcome: (symbol: string) => ProviderData | Error,
  overrides: Partial<CachedProviderOptions> = {},
) {
  let ms = 0;
  const clockDate = new Date("2026-11-05T21:30:00Z");
  const fetchIntraday = vi.fn((symbol: string) => {
    const r = outcome(symbol);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  });
  const cache = createCachedProvider(
    { fetchIntraday },
    {
      ttlSeconds: 60,
      notFoundTtlSeconds: 30,
      maxEntries: 500,
      clock: () => clockDate,
      nowMs: () => ms,
      ...overrides,
    },
  );
  return {
    cache,
    fetchIntraday,
    clockDate,
    advance: (seconds: number) => {
      ms += seconds * 1000;
    },
  };
}

describe("H11 provider-data cache", () => {
  it("serves repeat lookups from cache and reports the TTL left", async () => {
    const { cache, fetchIntraday, advance } = setup(data);

    const first = await cache.lookup("TSLA");
    advance(15);
    const second = await cache.lookup("TSLA");

    expect(first).toEqual({ ok: true, data: data("TSLA"), maxAgeSeconds: 60 });
    expect(second).toEqual({ ok: true, data: data("TSLA"), maxAgeSeconds: 45 });
    expect(fetchIntraday).toHaveBeenCalledTimes(1);
  });

  it("asks the provider for the window ending at the injected clock", async () => {
    const { cache, fetchIntraday, clockDate } = setup(data);

    await cache.lookup("TSLA");

    expect(fetchIntraday).toHaveBeenCalledWith("TSLA", clockDate);
  });

  it("refetches once the TTL has passed", async () => {
    const { cache, fetchIntraday, advance } = setup(data);

    await cache.lookup("TSLA");
    advance(60);
    await cache.lookup("TSLA");

    expect(fetchIntraday).toHaveBeenCalledTimes(2);
  });

  it("caches each symbol separately", async () => {
    const { cache, fetchIntraday } = setup(data);

    await cache.lookup("TSLA");
    await cache.lookup("AAPL");
    await cache.lookup("TSLA");

    expect(fetchIntraday).toHaveBeenCalledTimes(2);
  });

  it.each<[string, () => DomainError, number]>([
    ["404", () => new SymbolNotFound("x"), 30],
    ["422 unsupported instrument", () => new UnsupportedInstrument("CRYPTOCURRENCY"), 60],
    ["422 no intraday data", () => new IntradayUnavailable("1d"), 60],
  ])("caches a %s for %i s", async (_, makeError, ttl) => {
    const error = makeError();
    const { cache, fetchIntraday, advance } = setup(() => error);

    const first = await cache.lookup("X");
    advance(ttl - 1);
    const second = await cache.lookup("X");
    advance(1);
    await cache.lookup("X");

    expect(first).toEqual({ ok: false, error, maxAgeSeconds: ttl });
    expect(second).toEqual({ ok: false, error, maxAgeSeconds: 1 });
    expect(fetchIntraday).toHaveBeenCalledTimes(2);
  });

  it.each<[string, () => DomainError]>([
    ["429", () => new ProviderRateLimited(30)],
    ["5xx", () => new ProviderUnavailable("500")],
    ["timeout", () => new ProviderTimeout("slow")],
    ["bad payload", () => new ProviderBadResponse("garbage")],
  ])("never caches a %s", async (_, makeError) => {
    const error = makeError();
    const { cache, fetchIntraday } = setup(() => error);

    const first = await cache.lookup("X");
    await cache.lookup("X");

    expect(first).toEqual({ ok: false, error, maxAgeSeconds: null });
    expect(fetchIntraday).toHaveBeenCalledTimes(2);
  });

  it("does not let a failure evict good data for another symbol", async () => {
    const { cache, fetchIntraday } = setup((s) =>
      s === "BAD" ? new ProviderUnavailable("500") : data(s),
    );

    await cache.lookup("TSLA");
    await cache.lookup("BAD");
    await cache.lookup("TSLA");

    expect(fetchIntraday.mock.calls.map(([s]) => s)).toEqual(["TSLA", "BAD"]);
  });

  it("evicts the least recently used entry beyond the bound", async () => {
    const { cache, fetchIntraday } = setup(data, { maxEntries: 2 });

    await cache.lookup("A");
    await cache.lookup("B");
    await cache.lookup("A"); // A is now the most recently used
    await cache.lookup("C"); // evicts B
    await cache.lookup("A");
    await cache.lookup("B");

    expect(fetchIntraday.mock.calls.map(([s]) => s)).toEqual(["A", "B", "C", "B"]);
  });

  it("rethrows unexpected errors instead of turning them into results", async () => {
    const { cache } = setup(() => new TypeError("bug"));

    await expect(cache.lookup("X")).rejects.toThrow("bug");
  });
});
