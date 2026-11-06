import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ApiError, getDailySummary, parseRetryAfter } from "../src/api/client";

import { server } from "./support/server";

const URL = "/api/v1/stocks/:symbol/daily-summary";
const ROWS = [{ day: "2026-11-04", lowAverage: 385.5077, highAverage: 388.5708, volume: 58867385 }];

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected the request to fail");
}

describe("getDailySummary", () => {
  it("returns rows and reads the X- headers", async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json(ROWS, {
          headers: {
            "X-Exchange-Timezone": "America/New_York",
            "X-Currency": "USD",
            "X-Partial-Day": "2026-11-05",
            "X-Request-Id": "abc",
          },
        }),
      ),
    );
    const result = await getDailySummary("TSLA", new AbortController().signal);
    expect(result).toEqual({
      symbol: "TSLA",
      days: ROWS,
      timeZone: "America/New_York",
      currency: "USD",
      partialDay: "2026-11-05",
      requestId: "abc",
    });
  });

  it("returns nulls for absent optional headers", async () => {
    server.use(http.get(URL, () => HttpResponse.json([])));
    const result = await getDailySummary("TSLA", new AbortController().signal);
    expect(result).toMatchObject({ days: [], currency: null, partialDay: null, timeZone: null });
  });

  it("reads empty X- headers as absent", async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json([], { headers: { "X-Currency": " ", "X-Partial-Day": "" } }),
      ),
    );
    const result = await getDailySummary("TSLA", new AbortController().signal);
    expect(result).toMatchObject({ currency: null, partialDay: null });
  });

  it("encodes the symbol into the path", async () => {
    let seen = "";
    server.use(
      http.get(URL, ({ request }) => {
        seen = new globalThis.URL(request.url).pathname;
        return HttpResponse.json([]);
      }),
    );
    await getDailySummary("^GSPC", new AbortController().signal);
    expect(seen).toBe("/api/v1/stocks/%5EGSPC/daily-summary");
  });

  it("maps a problem body to a typed http error with Retry-After", async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Service Unavailable",
            status: 503,
            detail: "x",
            code: "UPSTREAM_RATE_LIMITED",
            requestId: "r",
          },
          {
            status: 503,
            headers: { "Retry-After": "30", "Content-Type": "application/problem+json" },
          },
        ),
      ),
    );
    const err = await failure(getDailySummary("TSLA", new AbortController().signal));
    expect(err.kind).toBe("http");
    expect(err.http).toEqual({
      status: 503,
      code: "UPSTREAM_RATE_LIMITED",
      retryAfterSeconds: 30,
      instrumentType: null,
    });
  });

  it("keeps a well-formed instrumentType and drops anything else", async () => {
    const problem = (instrumentType: string) =>
      HttpResponse.json(
        { status: 422, code: "UNSUPPORTED_INSTRUMENT", instrumentType },
        { status: 422 },
      );
    server.use(http.get(URL, () => problem("MUTUALFUND")));
    expect(
      (await failure(getDailySummary("VFIAX", new AbortController().signal))).http?.instrumentType,
    ).toBe("MUTUALFUND");
    server.use(http.get(URL, () => problem("<b>evil</b>")));
    expect(
      (await failure(getDailySummary("VFIAX", new AbortController().signal))).http?.instrumentType,
    ).toBeNull();
  });

  it("treats an unknown code or a non-JSON error body as status only", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ code: "SOMETHING_NEW" }, { status: 502 })));
    expect(
      (await failure(getDailySummary("TSLA", new AbortController().signal))).http,
    ).toMatchObject({ status: 502, code: null });
    server.use(http.get(URL, () => new HttpResponse("<html>Bad gateway</html>", { status: 502 })));
    expect(
      (await failure(getDailySummary("TSLA", new AbortController().signal))).http,
    ).toMatchObject({ status: 502, code: null });
  });

  it("classifies a caller abort as cancelled", async () => {
    server.use(
      http.get(URL, async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    );
    const controller = new AbortController();
    const pending = failure(getDailySummary("TSLA", controller.signal));
    controller.abort();
    expect((await pending).kind).toBe("cancelled");
  });

  it("classifies the client timeout as timeout, not network", async () => {
    server.use(
      http.get(URL, async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    );
    const err = await failure(
      getDailySummary("TSLA", new AbortController().signal, { timeoutMs: 30 }),
    );
    expect(err.kind).toBe("timeout");
  });

  it("classifies a rejected fetch as network", async () => {
    server.use(http.get(URL, () => HttpResponse.error()));
    expect((await failure(getDailySummary("TSLA", new AbortController().signal))).kind).toBe(
      "network",
    );
  });

  it("classifies an unparseable 200 body as bad_response, never network [R5-#6]", async () => {
    server.use(
      http.get(
        URL,
        () =>
          new HttpResponse("{not json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    expect((await failure(getDailySummary("TSLA", new AbortController().signal))).kind).toBe(
      "bad_response",
    );
  });

  it("classifies a TypeError while reading the body as bad_response", async () => {
    const fetchFn: typeof fetch = () => {
      const res = new Response("[]");
      Object.defineProperty(res, "json", {
        value: () => Promise.reject(new TypeError("body stream already read")),
      });
      return Promise.resolve(res);
    };
    const err = await failure(getDailySummary("TSLA", new AbortController().signal, { fetchFn }));
    expect(err.kind).toBe("bad_response");
  });

  it.each([
    ["an object instead of an array", { rows: [] }],
    ["a row with a Date-like day", [{ ...ROWS[0], day: "Nov 4 2026" }]],
    ["a row with a string price", [{ ...ROWS[0], lowAverage: "385.5" }]],
    ["a row with negative volume", [{ ...ROWS[0], volume: -1 }]],
  ])("rejects %s as bad_response", async (_label, body) => {
    server.use(http.get(URL, () => HttpResponse.json(body)));
    expect((await failure(getDailySummary("TSLA", new AbortController().signal))).kind).toBe(
      "bad_response",
    );
  });
});

describe("parseRetryAfter", () => {
  it.each([
    ["30", 30],
    [" 7 ", 7],
    ["0", 0],
    [null, null],
    ["", null],
    ["-5", null],
    ["1.5", null],
    ["Wed, 21 Oct 2026 07:28:00 GMT", null],
  ])("reads %j as %j", (value, expected) => {
    expect(parseRetryAfter(value)).toBe(expected);
  });
});
