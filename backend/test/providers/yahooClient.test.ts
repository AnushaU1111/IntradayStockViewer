import { describe, expect, it, vi } from "vitest";

import {
  ProviderBadResponse,
  ProviderBlocked,
  ProviderRateLimited,
  ProviderRejected,
  ProviderTimeout,
  ProviderUnavailable,
  SymbolNotFound,
} from "../../src/domain/errors.js";
import { parseRetryAfter } from "../../src/providers/yahoo/retryAfter.js";
import { createYahooProvider } from "../../src/providers/yahoo/yahooClient.js";
import { loadFixture } from "../support/fixtures.js";

const NOW = new Date("2026-11-05T21:30:00Z");
const BASE = "https://yahoo.test";

function respond(status: number, body: string, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status, headers })));
}

function fromFixture(name: string) {
  const f = loadFixture(name).response;
  return respond(f.status, f.bodyText ?? JSON.stringify(f.body), f.headers);
}

const provider = (fetchFn: typeof fetch) =>
  createYahooProvider({
    baseUrl: BASE,
    userAgent: "test-agent/1.0",
    fetchFn,
    nowMs: () => NOW.getTime(),
  });

describe("Yahoo client request", () => {
  it("asks for 15-minute bars over the 35 days ending now, regular session only", async () => {
    const fetchFn = fromFixture("TSLA");
    await provider(fetchFn).fetchIntraday("^GSPC", NOW);

    const [input, init] = fetchFn.mock.calls[0] ?? [];
    expect(input).toBeInstanceOf(URL);
    const url = input as URL;
    const end = NOW.getTime() / 1000;

    expect(url.origin + url.pathname).toBe(`${BASE}/v8/finance/chart/%5EGSPC`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      interval: "15m",
      period1: String(end - 35 * 86_400),
      period2: String(end),
      includePrePost: "false",
    });
    expect(new Headers(init?.headers).get("user-agent")).toBe("test-agent/1.0");
  });

  it("maps a 200 through the mapper", async () => {
    const data = await provider(fromFixture("TSLA")).fetchIntraday("TSLA", NOW);

    expect(data.bars).toHaveLength(650);
  });
});

describe("Yahoo client status classification", () => {
  it.each<[string, () => typeof fetch, new (...args: never[]) => Error]>([
    ["H1 404 with Yahoo's body", () => fromFixture("unknown-symbol"), SymbolNotFound],
    ["404 with an empty body", () => respond(404, ""), SymbolNotFound],
    ["400 from Yahoo", () => respond(400, "{}"), ProviderRejected],
    ["422 from Yahoo", () => respond(422, "{}"), ProviderRejected],
    ["500", () => respond(500, "oops"), ProviderUnavailable],
    ["503", () => respond(503, ""), ProviderUnavailable],
    ["200 that is not JSON", () => respond(200, "<html>"), ProviderBadResponse],
    ["302 redirect", () => respond(302, ""), ProviderBadResponse],
  ])("%s", async (_, fetchFn, expected) => {
    await expect(provider(fetchFn()).fetchIntraday("X", NOW)).rejects.toBeInstanceOf(expected);
  });

  it("H5 reads Retry-After from a plain-text 429", async () => {
    const err = await provider(respond(429, "Too Many Requests", { "retry-after": "120" }))
      .fetchIntraday("X", NOW)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderRateLimited);
    expect((err as ProviderRateLimited).retryAfterSeconds).toBe(120);
  });

  it.each([401, 403])("H6 treats %i as blocked", async (status) => {
    const err = await provider(respond(status, ""))
      .fetchIntraday("X", NOW)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderBlocked);
    expect((err as ProviderBlocked).retryAfterSeconds).toBeNull();
  });
});

describe("Yahoo client transport failures", () => {
  it("maps an attempt timeout to ProviderTimeout", async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.reject(new DOMException("The operation timed out", "TimeoutError")),
    );

    await expect(provider(fetchFn).fetchIntraday("X", NOW)).rejects.toBeInstanceOf(ProviderTimeout);
  });

  it("maps a network failure to ProviderUnavailable", async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));

    await expect(provider(fetchFn).fetchIntraday("X", NOW)).rejects.toBeInstanceOf(
      ProviderUnavailable,
    );
  });

  it("passes a caller's cancellation through untouched", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(abort));

    await expect(provider(fetchFn).fetchIntraday("X", NOW)).rejects.toBe(abort);
  });

  it("forwards the caller's signal to fetch", async () => {
    const fetchFn = fromFixture("TSLA");
    const signal = new AbortController().signal;

    await provider(fetchFn).fetchIntraday("TSLA", NOW, signal);

    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBe(signal);
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-11-05T21:30:00Z");

  it.each([
    ["120", 120],
    ["0", 0],
    [" 30 ", 30],
    ["Thu, 05 Nov 2026 21:32:00 GMT", 120],
    ["Thu, 05 Nov 2026 21:29:00 GMT", 0],
  ])("parses %j as %i seconds", (header, seconds) => {
    expect(parseRetryAfter(header, now)).toBe(seconds);
  });

  it.each([null, "", "soon", "-5", "1.5", "12abc"])("returns null for %j", (header) => {
    expect(parseRetryAfter(header, now)).toBeNull();
  });
});
