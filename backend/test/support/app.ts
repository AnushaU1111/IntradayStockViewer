import type { FastifyInstance } from "fastify";
import { vi } from "vitest";

import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import { loadFixture } from "./fixtures.js";
import { sliceFixture } from "./sliceFixture.js";

const FIXTURE_BY_SYMBOL: Record<string, string> = {
  TSLA: "TSLA",
  "^GSPC": "GSPC",
  "BTC-USD": "BTC-USD",
  VFIAX: "VFIAX",
};

const symbolOf = (url: URL) => decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
const toUrl = (input: Parameters<typeof fetch>[0]) =>
  new URL(input instanceof Request ? input.url : input);

/** Answers like Yahoo would: the captured fixture for the symbol, sliced to the requested window. */
export function fakeYahoo(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>((input) => {
    const url = toUrl(input);
    const name = FIXTURE_BY_SYMBOL[symbolOf(url)] ?? "unknown-symbol";
    const sliced = sliceFixture(
      loadFixture(name),
      Number(url.searchParams.get("period1")),
      Number(url.searchParams.get("period2")),
    ).response;
    return Promise.resolve(
      new Response(sliced.bodyText ?? JSON.stringify(sliced.body), {
        status: sliced.status,
        headers: sliced.headers,
      }),
    );
  });
}

/** A fetch that returns the same status, body and headers for every request. */
export function fixedResponse(status: number, body = "", headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status, headers })));
}

/** A fetch that never answers until aborted. */
export function hangingFetch() {
  return vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      }),
  );
}

export const AFTER_CLOSE = "2026-11-05T21:30:00Z";
export const IN_SESSION = "2026-11-05T18:00:00Z";

export async function testApp(
  options: { env?: Record<string, string>; fetchFn?: typeof fetch; clock?: string } = {},
): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    CLOCK_FIXED_AT: options.clock ?? AFTER_CLOSE,
    ...options.env,
  });
  return buildApp({ config, fetchFn: options.fetchFn ?? fakeYahoo() });
}
