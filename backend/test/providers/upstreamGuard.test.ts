import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProviderBadResponse,
  ProviderBlocked,
  ProviderRateLimited,
  ProviderRejected,
  ProviderTimeout,
  ProviderUnavailable,
  SymbolNotFound,
} from "../../src/domain/errors.js";
import type { MarketDataProvider, ProviderData } from "../../src/providers/marketDataProvider.js";
import {
  createUpstreamGuard,
  type UpstreamGuardOptions,
} from "../../src/providers/upstreamGuard.js";

const NOW = new Date("2026-11-05T21:30:00Z");
const DATA: ProviderData = {
  bars: [],
  outsideSession: 0,
  info: {
    timeZone: "America/New_York",
    currency: "USD",
    instrumentType: "EQUITY",
    sessionStart: null,
    sessionEnd: null,
  },
};

type Step = ProviderData | Error | "hang" | "ignore-signal";

/** A provider that plays back one scripted outcome per call; "hang" waits for the abort. */
function scripted(...steps: Step[]) {
  const calls: { at: number }[] = [];
  const provider: MarketDataProvider = {
    fetchIntraday(_symbol, _now, signal) {
      calls.push({ at: Date.now() });
      const step = steps.shift() ?? DATA;
      if (step === "ignore-signal") return new Promise<never>(() => undefined);
      if (step === "hang") {
        return new Promise<never>((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new ProviderTimeout("attempt timed out"));
          });
        });
      }
      return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
    },
  };
  return { provider, calls };
}

const OPTIONS: UpstreamGuardOptions = {
  totalTimeoutMs: 8000,
  attemptTimeoutMs: 3000,
  retries: 2,
  cooldownFallbackSeconds: 30,
  nowMs: () => Date.now(),
  random: () => 0.5, // jitter factor exactly 1, so backoff is 200 ms then 600 ms
};

const guarded = (provider: MarketDataProvider, overrides: Partial<UpstreamGuardOptions> = {}) =>
  createUpstreamGuard(provider, { ...OPTIONS, ...overrides });

/** Runs a fetch while advancing fake time until it settles. */
async function settle<T>(
  promise: Promise<T>,
): Promise<{ value?: T; error?: unknown; elapsed: number }> {
  const start = Date.now();
  const flag = { done: false };
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  void outcome.then(() => (flag.done = true));
  while (!flag.done) await vi.advanceTimersByTimeAsync(50);
  return { ...(await outcome), elapsed: Date.now() - start };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("deadline and retries", () => {
  it("H7 retries a transient 5xx and succeeds", async () => {
    const { provider, calls } = scripted(new ProviderUnavailable("500"), DATA);

    const r = await settle(guarded(provider).fetchIntraday("TSLA", NOW));

    expect(r.value).toBe(DATA);
    expect(calls).toHaveLength(2);
    expect((calls[1]?.at ?? 0) - (calls[0]?.at ?? 0)).toBe(200); // backoff is real waiting time
  });

  it("gives up after the retry budget with the last error", async () => {
    const { provider, calls } = scripted(
      ...Array.from({ length: 5 }, () => new ProviderUnavailable("500")),
    );

    const r = await settle(guarded(provider).fetchIntraday("TSLA", NOW));

    expect(r.error).toBeInstanceOf(ProviderUnavailable);
    expect(calls).toHaveLength(3);
  });

  it("H8 stops a hanging upstream within the 8 s total budget", async () => {
    const { provider, calls } = scripted("hang", "hang", "hang");

    const r = await settle(guarded(provider).fetchIntraday("TSLA", NOW));

    expect(r.error).toBeInstanceOf(ProviderTimeout);
    expect(r.elapsed).toBeLessThanOrEqual(8000);
    // 3000 ms, 200 ms backoff, 3000 ms, 600 ms backoff, then only 1200 ms left.
    expect(calls.map((c) => c.at - NOW.getTime())).toEqual([0, 3200, 6800]);
  });

  it("does not start an attempt with less than 1 s left", async () => {
    const { provider, calls } = scripted("hang", "hang", "hang");

    const r = await settle(guarded(provider, { totalTimeoutMs: 7000 }).fetchIntraday("TSLA", NOW));

    expect(r.error).toBeInstanceOf(ProviderTimeout);
    expect(calls).toHaveLength(2); // a third would start at 6800 ms with 200 ms left
    expect(r.elapsed).toBeLessThanOrEqual(7000);
  });

  it("enforces the deadline even if the provider ignores its abort signal", async () => {
    const { provider } = scripted("ignore-signal", "ignore-signal", "ignore-signal");

    const r = await settle(guarded(provider).fetchIntraday("TSLA", NOW));

    expect(r.error).toBeInstanceOf(ProviderTimeout);
    expect(r.elapsed).toBeLessThanOrEqual(8000);
  });

  it.each([
    ["not found", new SymbolNotFound("x")],
    ["rejected", new ProviderRejected("x")],
    ["bad response", new ProviderBadResponse("x")],
  ])("does not retry %s", async (_, error) => {
    const { provider, calls } = scripted(error);

    const r = await settle(guarded(provider).fetchIntraday("TSLA", NOW));

    expect(r.error).toBe(error);
    expect(calls).toHaveLength(1);
  });

  it("stays closed when 5xx retries run out", async () => {
    const { provider } = scripted(
      ...Array.from({ length: 3 }, () => new ProviderUnavailable("500")),
    );
    const guard = guarded(provider);

    await settle(guard.fetchIntraday("TSLA", NOW));

    expect(guard.state().kind).toBe("closed");
  });
});

describe("cooldown", () => {
  it("H5 honors Retry-After exactly and makes no upstream call until it elapses", async () => {
    const { provider, calls } = scripted(new ProviderRateLimited(120));
    const guard = guarded(provider);

    const first = await settle(guard.fetchIntraday("TSLA", NOW));
    await vi.advanceTimersByTimeAsync(60_000);
    const during = await settle(guard.fetchIntraday("AAPL", NOW));

    expect(first.error).toBeInstanceOf(ProviderRateLimited);
    expect((first.error as ProviderRateLimited).retryAfterSeconds).toBe(120);
    expect(during.error).toBeInstanceOf(ProviderRateLimited);
    expect((during.error as ProviderRateLimited).retryAfterSeconds).toBe(60);
    expect(calls).toHaveLength(1);
  });

  it("falls back to 30 s when the 429 has no usable Retry-After", async () => {
    const { provider } = scripted(new ProviderRateLimited(null));
    const guard = guarded(provider);

    const r = await settle(guard.fetchIntraday("TSLA", NOW));

    expect((r.error as ProviderRateLimited).retryAfterSeconds).toBe(30);
  });

  it("does not retry a 429 inside the same request", async () => {
    const { provider, calls } = scripted(new ProviderRateLimited(5));

    await settle(guarded(provider).fetchIntraday("TSLA", NOW));

    expect(calls).toHaveLength(1);
  });

  it("H6 opens on a 403 and reports blocked while open", async () => {
    const { provider, calls } = scripted(new ProviderBlocked(null));
    const guard = guarded(provider);

    await settle(guard.fetchIntraday("TSLA", NOW));
    await vi.advanceTimersByTimeAsync(10_000);
    const during = await settle(guard.fetchIntraday("TSLA", NOW));

    expect(guard.state().kind).toBe("open");
    expect(during.error).toBeInstanceOf(ProviderBlocked);
    expect((during.error as ProviderBlocked).retryAfterSeconds).toBe(20);
    expect(calls).toHaveLength(1);
  });

  describe("H5b every probe outcome", () => {
    it.each<[string, "closed" | "open", Step, number | null]>([
      ["success", "closed", DATA, null],
      ["404", "closed", new SymbolNotFound("x"), null],
      ["400", "closed", new ProviderRejected("x"), null],
      ["malformed payload", "closed", new ProviderBadResponse("x"), null],
      ["429 without Retry-After", "open", new ProviderRateLimited(null), 30],
      ["429 with Retry-After 90", "open", new ProviderRateLimited(90), 90],
      ["401 or 403", "open", new ProviderBlocked(null), 30],
      ["500", "open", new ProviderUnavailable("500"), 30],
      ["network error", "open", new ProviderUnavailable("network"), 30],
      ["timeout", "open", "hang", 30],
    ])("probe gets %s: state becomes %s", async (_, next, probeOutcome, openSeconds) => {
      const { provider, calls } = scripted(new ProviderRateLimited(10), probeOutcome, DATA);
      const guard = guarded(provider);

      await settle(guard.fetchIntraday("TSLA", NOW)); // opens for 10 s
      await vi.advanceTimersByTimeAsync(10_000);
      const probeStart = Date.now();
      await settle(guard.fetchIntraday("TSLA", NOW)); // the probe

      const state = guard.state();
      expect(state.kind).toBe(next);
      if (state.kind === "open" && openSeconds !== null) {
        expect(state.until - Date.now()).toBeLessThanOrEqual(openSeconds * 1000);
        expect(state.until - probeStart).toBeGreaterThanOrEqual(openSeconds * 1000);
      }
      expect(calls).toHaveLength(2); // the probe is a single attempt: no retries
    });
  });

  it("H5c answers requests that arrive during the probe without calling upstream", async () => {
    const { provider, calls } = scripted(new ProviderRateLimited(10), "hang");
    const guard = guarded(provider);

    await settle(guard.fetchIntraday("TSLA", NOW));
    await vi.advanceTimersByTimeAsync(10_000);
    const probe = guard.fetchIntraday("TSLA", NOW);
    const others = await Promise.allSettled([
      guard.fetchIntraday("AAPL", NOW),
      guard.fetchIntraday("MSFT", NOW),
      guard.fetchIntraday("NVDA", NOW),
    ]);

    for (const r of others) {
      expect(r.status).toBe("rejected");
      const reason = (r as PromiseRejectedResult).reason as ProviderRateLimited;
      expect(reason).toBeInstanceOf(ProviderRateLimited);
      expect(reason.retryAfterSeconds).toBe(2);
    }
    expect(guard.state().kind).toBe("halfOpen");
    await settle(probe);
    expect(calls).toHaveLength(2);
  });

  it("H5d never stays half-open when the probe throws something unexpected", async () => {
    const { provider } = scripted(new ProviderRateLimited(10), new Error("bug in provider"));
    const guard = guarded(provider);

    await settle(guard.fetchIntraday("TSLA", NOW));
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await settle(guard.fetchIntraday("TSLA", NOW));

    expect((r.error as Error).message).toBe("bug in provider");
    expect(guard.state().kind).toBe("open");
  });

  it("recovers fully after a successful probe", async () => {
    const { provider, calls } = scripted(new ProviderRateLimited(10), DATA, DATA, DATA);
    const guard = guarded(provider);

    await settle(guard.fetchIntraday("TSLA", NOW));
    await vi.advanceTimersByTimeAsync(10_000);
    await settle(guard.fetchIntraday("TSLA", NOW));
    const after = await Promise.all([
      guard.fetchIntraday("AAPL", NOW),
      guard.fetchIntraday("MSFT", NOW),
    ]);

    expect(after).toEqual([DATA, DATA]);
    expect(calls).toHaveLength(4);
  });
});

describe("cancellation", () => {
  it("passes a caller's abort through without retrying", async () => {
    const controller = new AbortController();
    const abort = new DOMException("aborted", "AbortError");
    const fetchIntraday = vi.fn((_s: string, _n: Date, signal?: AbortSignal) => {
      return new Promise<ProviderData>((_, reject) => {
        signal?.addEventListener("abort", () => {
          reject(signal.reason as Error);
        });
      });
    });
    const provider: MarketDataProvider = { fetchIntraday };

    const pending = settle(guarded(provider).fetchIntraday("TSLA", NOW, controller.signal));
    controller.abort(abort);
    const r = await pending;

    expect(r.error).toBe(abort);
    expect(fetchIntraday).toHaveBeenCalledTimes(1);
  });
});
