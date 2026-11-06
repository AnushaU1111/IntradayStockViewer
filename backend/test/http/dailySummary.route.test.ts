import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import {
  AFTER_CLOSE,
  IN_SESSION,
  fakeYahoo,
  fixedResponse,
  hangingFetch,
  testApp,
} from "../support/app.js";

const golden = (scenario: string) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/golden/golden.${scenario}.json`, import.meta.url), "utf8"),
  ) as { expected: unknown[] };

const path = (symbol: string) => `/api/v1/stocks/${encodeURIComponent(symbol)}/daily-summary`;

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function get(symbol: string, options: Parameters<typeof testApp>[0] = {}) {
  app = await testApp(options);
  return app.inject({ method: "GET", url: path(symbol) });
}

describe("GET /api/v1/stocks/:symbol/daily-summary", () => {
  it("returns the exact contract for TSLA after the close", async () => {
    const res = await get("TSLA");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.json()).toEqual(golden("after-close").expected);
    expect(res.headers["x-exchange-timezone"]).toBe("America/New_York");
    expect(res.headers["x-currency"]).toBe("USD");
    expect(res.headers["x-partial-day"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("marks the partial day while the session is open", async () => {
    const res = await get("TSLA", { clock: IN_SESSION });

    expect(res.json()).toEqual(golden("in-session").expected);
    expect(res.headers["x-partial-day"]).toBe("2026-11-05");
  });

  it("normalizes the symbol and decodes ^ from the path", async () => {
    const fetchFn = fakeYahoo();
    app = await testApp({ fetchFn });

    const lower = await app.inject({ method: "GET", url: path("  tsla ") });
    const index = await app.inject({ method: "GET", url: path("^GSPC") });

    expect(lower.statusCode).toBe(200);
    expect(index.statusCode).toBe(200);
    const symbols = fetchFn.mock.calls.map(([u]) =>
      decodeURIComponent((u as URL).pathname.split("/").at(-1) ?? ""),
    );
    expect(symbols).toEqual(["TSLA", "^GSPC"]);
  });

  describe("V3 and V4 invalid symbols never reach Yahoo", () => {
    it.each([
      "../etc",
      "TSLA;DROP",
      "<script>",
      "T SLA",
      "tſla",
      "ıbm",
      "A".repeat(33),
      "A".repeat(256),
      "%20",
    ])("rejects %j with 400 INVALID_SYMBOL", async (symbol) => {
      const fetchFn = fakeYahoo();
      const res = await get(symbol, { fetchFn });

      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(res.json()).toMatchObject({ status: 400, code: "INVALID_SYMBOL" });
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  it.each([
    [
      "a symbol over the 256-character route limit",
      `/api/v1/stocks/${"A".repeat(257)}/daily-summary`,
      414,
    ],
    ["a malformed percent-encoding", "/api/v1/stocks/%E0%A4%A/daily-summary", 400],
  ])("answers %s with problem+json that does not echo the path", async (_label, url, status) => {
    const fetchFn = fakeYahoo();
    app = await testApp({ fetchFn });
    const res = await app.inject({ method: "GET", url });

    expect(res.statusCode).toBe(status);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(res.json()).toMatchObject({ type: "about:blank", status, code: "BAD_REQUEST" });
    expect(res.body).not.toContain("AAAA");
    expect(res.body).not.toContain("%E0");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("H1 returns 404 for an unknown symbol, cached for 30 s", async () => {
    const res = await get("ZZZZNOTREAL1");

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ status: 404, code: "SYMBOL_NOT_FOUND" });
    expect(res.headers["cache-control"]).toBe("public, max-age=30");
  });

  it("H1 hints at Yahoo's share-class notation", async () => {
    const res = await get("BRK.B");

    expect(res.json<{ detail: string }>().detail).toContain("BRK-B");
  });

  it("H3 returns 422 for crypto and names the instrument type", async () => {
    const res = await get("BTC-USD");

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: "UNSUPPORTED_INSTRUMENT",
      instrumentType: "CRYPTOCURRENCY",
    });
  });

  it("H4 returns 422 when there is no 15-minute data", async () => {
    const res = await get("VFIAX");

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "INTRADAY_UNAVAILABLE" });
  });

  it("H5 maps a Yahoo 429 to 503 with Retry-After and stops calling Yahoo", async () => {
    const fetchFn = fixedResponse(429, "Too Many Requests", { "retry-after": "120" });
    app = await testApp({ fetchFn });

    const first = await app.inject({ method: "GET", url: path("TSLA") });
    const second = await app.inject({ method: "GET", url: path("AAPL") });

    expect(first.statusCode).toBe(503);
    expect(first.json()).toMatchObject({ code: "UPSTREAM_RATE_LIMITED" });
    expect(first.headers["retry-after"]).toBe("120");
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(second.statusCode).toBe(503);
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("H6 maps a Yahoo 403 to 503 blocked with the fallback Retry-After", async () => {
    const res = await get("TSLA", { fetchFn: fixedResponse(403) });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "UPSTREAM_BLOCKED" });
    expect(res.headers["retry-after"]).toBe("30");
  });

  it("maps repeated 5xx to 502 after retries, uncached", async () => {
    const fetchFn = fixedResponse(500, "oops");
    const res = await get("TSLA", {
      fetchFn,
      env: { UPSTREAM_TOTAL_TIMEOUT_MS: "3000", UPSTREAM_ATTEMPT_TIMEOUT_MS: "500" },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("maps a Yahoo 400 to 502 rejected", async () => {
    const res = await get("TSLA", { fetchFn: fixedResponse(400, "{}") });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: "UPSTREAM_REJECTED" });
  });

  it("H8 returns 504 when Yahoo never answers within the deadline", async () => {
    const res = await get("TSLA", {
      fetchFn: hangingFetch(),
      env: { UPSTREAM_TOTAL_TIMEOUT_MS: "300", UPSTREAM_ATTEMPT_TIMEOUT_MS: "100" },
    });

    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  });

  it("H9 maps a malformed payload to 502 without leaking upstream text", async () => {
    const res = await get("TSLA", {
      fetchFn: fixedResponse(200, "<html>secret upstream page</html>"),
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: "UPSTREAM_BAD_RESPONSE" });
    expect(res.body).not.toContain("secret upstream page");
  });

  it("H11 serves the second request from cache with the remaining max-age", async () => {
    const fetchFn = fakeYahoo();
    app = await testApp({ fetchFn });

    const first = await app.inject({ method: "GET", url: path("TSLA") });
    const second = await app.inject({ method: "GET", url: path("TSLA") });

    expect(first.json()).toEqual(second.json());
    expect(Number(second.headers["cache-control"]?.toString().split("=")[1])).toBeLessThanOrEqual(
      60,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("R3 never serializes more than 4 decimals", async () => {
    const res = await get("TSLA");

    expect(res.body).not.toMatch(/\d\.\d{5,}/);
  });

  it("keeps the clock fixed for every request in test mode", async () => {
    const res = await get("TSLA", { clock: AFTER_CLOSE });

    expect(res.json<{ day: string }[]>().at(-1)?.day).toBe("2026-11-05");
  });
});
