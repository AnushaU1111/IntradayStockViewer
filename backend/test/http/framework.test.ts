import { afterEach, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import { testApp } from "../support/app.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const problem = (res: { headers: Record<string, unknown>; json: () => unknown }) => {
  expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
  return res.json() as Record<string, unknown>;
};

describe("H10 every error is problem+json", () => {
  it("unknown route: 404 NOT_FOUND", async () => {
    app = await testApp();
    const res = await app.inject({ method: "GET", url: "/nope" });

    expect(res.statusCode).toBe(404);
    expect(problem(res)).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("per-IP rate limit: 429 RATE_LIMITED with Retry-After", async () => {
    app = await testApp({ env: { RATE_LIMIT_PER_MINUTE: "2" } });
    const call = () => app?.inject({ method: "GET", url: "/api/v1/stocks/TSLA/daily-summary" });

    await call();
    await call();
    const res = await call();

    expect(res?.statusCode).toBe(429);
    expect(res && problem(res)).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(Number(res?.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("thrown error: 500 INTERNAL_ERROR without internals", async () => {
    app = await testApp();
    app.get("/__test/throw", () => {
      throw new Error("database password is hunter2");
    });

    const res = await app.inject({ method: "GET", url: "/__test/throw" });

    expect(res.statusCode).toBe(500);
    expect(problem(res)).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(res.body).not.toContain("hunter2");
    expect(res.body).not.toContain("at ");
  });

  it("schema validation error: 400 BAD_REQUEST", async () => {
    app = await testApp();
    app.get(
      "/__test/schema",
      {
        schema: {
          querystring: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
        },
      },
      () => ({ ok: true }),
    );

    const res = await app.inject({ method: "GET", url: "/__test/schema?n=abc" });

    expect(res.statusCode).toBe(400);
    expect(problem(res)).toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("carries the request id in the body and the header", async () => {
    app = await testApp();
    const res = await app.inject({ method: "GET", url: "/nope" });

    expect(problem(res).requestId).toBe(res.headers["x-request-id"]);
  });
});

describe("request ids", () => {
  it("keeps a well-formed incoming X-Request-Id", async () => {
    app = await testApp();
    const res = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-request-id": "abc-123" },
    });

    expect(res.headers["x-request-id"]).toBe("abc-123");
  });

  it("replaces a malformed one instead of echoing it", async () => {
    app = await testApp();
    const res = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-request-id": "bad id\nwith newline" },
    });

    expect(res.headers["x-request-id"]).not.toContain("bad");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("health", () => {
  it("answers live and ready without calling Yahoo or counting against the rate limit", async () => {
    app = await testApp({ env: { RATE_LIMIT_PER_MINUTE: "1" } });

    for (let i = 0; i < 3; i += 1) {
      expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
    }
  });
});

describe("security headers", () => {
  it("locks down the API's own responses", async () => {
    app = await testApp();
    const res = await app.inject({ method: "GET", url: "/health/live" });

    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("CORS", () => {
  it("is off by default: same-origin only", async () => {
    app = await testApp();
    const res = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { origin: "https://evil.example" },
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows only configured origins and exposes the metadata headers", async () => {
    app = await testApp({ env: { CORS_ORIGINS: "http://localhost:5173" } });

    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/stocks/TSLA/daily-summary",
      headers: { origin: "http://localhost:5173" },
    });
    const other = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { origin: "https://evil.example" },
    });

    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(String(allowed.headers["access-control-expose-headers"])).toContain("X-Partial-Day");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("H14 proxy trust", () => {
  const limited = async (trustProxy: string, remoteAddress: string, forwarded: string[]) => {
    app = await testApp({ env: { RATE_LIMIT_PER_MINUTE: "1", TRUST_PROXY: trustProxy } });
    const codes: number[] = [];
    for (const ip of forwarded) {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/stocks/TSLA/daily-summary",
        remoteAddress,
        headers: { "x-forwarded-for": ip },
      });
      codes.push(res.statusCode);
    }
    return codes;
  };

  it("ignores X-Forwarded-For when no proxy is trusted", async () => {
    // Spoofed client IPs from one address still share one rate-limit bucket.
    expect(await limited("false", "198.51.100.7", ["203.0.113.1", "203.0.113.2"])).toEqual([
      200, 429,
    ]);
  });

  it("uses X-Forwarded-For only from the trusted proxy", async () => {
    expect(await limited("10.0.0.5", "10.0.0.5", ["203.0.113.1", "203.0.113.2"])).toEqual([
      200, 200,
    ]);
  });

  it("ignores X-Forwarded-For from any other address", async () => {
    expect(await limited("10.0.0.5", "198.51.100.7", ["203.0.113.1", "203.0.113.2"])).toEqual([
      200, 429,
    ]);
  });
});
