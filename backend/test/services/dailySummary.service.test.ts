import { describe, expect, it, vi } from "vitest";

import { ProviderUnavailable, SymbolNotFound } from "../../src/domain/errors.js";
import type { CachedProvider, LookupResult } from "../../src/providers/cachedProvider.js";
import type { ProviderData } from "../../src/providers/marketDataProvider.js";
import { createDailySummaryService } from "../../src/services/dailySummary.service.js";

const sec = (iso: string) => Date.parse(iso) / 1000;

// Two days of bars and a Nov 5 regular session, 14:30 to 21:00 UTC.
const DATA: ProviderData = {
  bars: [
    { t: sec("2026-10-05T14:30:00Z"), low: 10, high: 12, volume: 100 },
    { t: sec("2026-11-05T14:30:00Z"), low: 20, high: 22, volume: 200 },
  ],
  outsideSession: 1,
  info: {
    timeZone: "America/New_York",
    currency: "USD",
    instrumentType: "EQUITY",
    sessionStart: sec("2026-11-05T14:30:00Z"),
    sessionEnd: sec("2026-11-05T21:00:00Z"),
  },
};

function setup(result: LookupResult | ((symbol: string) => LookupResult), clocks: string[]) {
  const times = clocks.map((iso) => new Date(iso));
  const lookup = vi.fn((symbol: string) =>
    Promise.resolve(typeof result === "function" ? result(symbol) : result),
  );
  const warn = vi.fn();
  let i = 0;
  const service = createDailySummaryService({
    provider: { lookup } satisfies CachedProvider,
    clock: () => times[Math.min(i++, times.length - 1)] ?? new Date(0),
    logger: { warn },
  });
  return { service, lookup, warn };
}

const cached = (data: ProviderData, maxAgeSeconds = 60): LookupResult => ({
  ok: true,
  data,
  maxAgeSeconds,
});

describe("daily summary service", () => {
  it("returns the days, the response metadata and the cache age", async () => {
    const { service } = setup(cached(DATA, 42), ["2026-11-05T21:30:00Z"]);

    expect(await service.getDailySummary("TSLA")).toEqual({
      ok: true,
      days: [
        { day: "2026-10-05", lowAverage: 10, highAverage: 12, volume: 100 },
        { day: "2026-11-05", lowAverage: 20, highAverage: 22, volume: 200 },
      ],
      meta: { timeZone: "America/New_York", currency: "USD", partialDay: null },
      maxAgeSeconds: 42,
    });
  });

  it("H11b recomputes the window from the clock when the date changes over cached data", async () => {
    // 23:59:30 ET on Nov 5, then 00:00:20 ET on Nov 6, both served from the same cache entry.
    const { service, lookup } = setup(cached(DATA), [
      "2026-11-06T04:59:30Z",
      "2026-11-06T05:00:20Z",
    ]);

    const before = await service.getDailySummary("TSLA");
    const after = await service.getDailySummary("TSLA");

    expect(before.ok && before.days.map((d) => d.day)).toEqual(["2026-10-05", "2026-11-05"]);
    expect(after.ok && after.days.map((d) => d.day)).toEqual(["2026-11-05"]); // Oct 5 left the window
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("H11b recomputes the partial day from the clock over cached data", async () => {
    const { service } = setup(cached(DATA), ["2026-11-05T18:00:00Z", "2026-11-05T21:00:00Z"]);

    const open = await service.getDailySummary("TSLA");
    const closed = await service.getDailySummary("TSLA");

    expect(open.ok && open.meta.partialDay).toBe("2026-11-05");
    expect(closed.ok && closed.meta.partialDay).toBeNull();
  });

  it("passes provider failures through with their cache age", async () => {
    const notFound = new SymbolNotFound("x");
    const down = new ProviderUnavailable("500");

    const a = await setup({ ok: false, error: notFound, maxAgeSeconds: 30 }, [
      "2026-11-05T21:30:00Z",
    ]).service.getDailySummary("X");
    const b = await setup({ ok: false, error: down, maxAgeSeconds: null }, [
      "2026-11-05T21:30:00Z",
    ]).service.getDailySummary("X");

    expect(a).toEqual({ ok: false, error: notFound, maxAgeSeconds: 30 });
    expect(b).toEqual({ ok: false, error: down, maxAgeSeconds: null });
  });

  it("turns an aggregation failure into an uncached bad response", async () => {
    const huge: ProviderData = {
      ...DATA,
      bars: [
        { t: sec("2026-11-05T14:30:00Z"), low: 1, high: 2, volume: Number.MAX_SAFE_INTEGER },
        { t: sec("2026-11-05T14:45:00Z"), low: 1, high: 2, volume: 1 },
      ],
    };
    const result = await setup(cached(huge), ["2026-11-05T21:30:00Z"]).service.getDailySummary(
      "TSLA",
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("UPSTREAM_BAD_RESPONSE");
    expect(!result.ok && result.maxAgeSeconds).toBeNull();
  });

  it("logs data-quality diagnostics when bars were excluded", async () => {
    const dirty: ProviderData = {
      ...DATA,
      bars: [...DATA.bars, { t: sec("2026-11-05T14:45:00Z"), low: null, high: 22, volume: 5 }],
    };
    const { service, warn } = setup(cached(dirty), ["2026-11-05T21:30:00Z"]);

    await service.getDailySummary("TSLA");

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "TSLA", nullPrice: 1, outsideSession: 1 }),
      "bars excluded from the daily summary",
    );
  });

  it("does not warn for the routine closing-price stub alone", async () => {
    const { service, warn } = setup(cached(DATA), ["2026-11-05T21:30:00Z"]);

    await service.getDailySummary("TSLA");

    expect(warn).not.toHaveBeenCalled();
  });
});
