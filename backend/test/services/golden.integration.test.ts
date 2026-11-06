import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createCachedProvider } from "../../src/providers/cachedProvider.js";
import { createUpstreamGuard } from "../../src/providers/upstreamGuard.js";
import { createYahooProvider } from "../../src/providers/yahoo/yahooClient.js";
import { createDailySummaryService } from "../../src/services/dailySummary.service.js";
import { loadFixture } from "../support/fixtures.js";
import { sliceFixture } from "../support/sliceFixture.js";

interface Golden {
  clock: string;
  expectedHeaders: {
    "X-Exchange-Timezone": string;
    "X-Currency": string;
    "X-Partial-Day": string | null;
  };
  expected: unknown[];
}

const tsla = loadFixture("TSLA");

/** Answers like Yahoo would have for the requested window: the fixture sliced to it. */
const fakeYahoo = vi.fn<typeof fetch>((input) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const period1 = Number(url.searchParams.get("period1"));
  const period2 = Number(url.searchParams.get("period2"));
  const sliced = sliceFixture(tsla, period1, period2);
  return Promise.resolve(new Response(JSON.stringify(sliced.response.body), { status: 200 }));
});

describe.each(["after-close", "in-session"])(
  "A11 through the real provider stack: %s",
  (scenario) => {
    const golden = JSON.parse(
      readFileSync(new URL(`../fixtures/golden/golden.${scenario}.json`, import.meta.url), "utf8"),
    ) as Golden;
    const clock = () => new Date(golden.clock);

    it("client, mapper, guard, cache and service reproduce the Python oracle", async () => {
      const yahoo = createYahooProvider({
        baseUrl: "https://yahoo.test",
        userAgent: "test",
        fetchFn: fakeYahoo,
      });
      const guard = createUpstreamGuard(yahoo, {
        totalTimeoutMs: 8000,
        attemptTimeoutMs: 3000,
        retries: 2,
        cooldownFallbackSeconds: 30,
      });
      const cache = createCachedProvider(guard, {
        ttlSeconds: 60,
        notFoundTtlSeconds: 30,
        maxEntries: 500,
        clock,
      });
      const service = createDailySummaryService({
        provider: cache,
        clock,
        logger: { warn: vi.fn() },
      });

      const result = await service.getDailySummary("TSLA");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.days).toEqual(golden.expected);
      expect(result.meta).toEqual({
        timeZone: golden.expectedHeaders["X-Exchange-Timezone"],
        currency: golden.expectedHeaders["X-Currency"],
        partialDay: golden.expectedHeaders["X-Partial-Day"],
      });
    });
  },
);
