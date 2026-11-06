import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../../src/config/env.js";

const load = (env: Record<string, string>) => loadConfig(env);
const failure = (env: Record<string, string>) => {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.message;
    throw err;
  }
  throw new Error("expected loadConfig to fail");
};

describe("loadConfig", () => {
  it("applies the spec's defaults (section 4.6)", () => {
    expect(load({})).toEqual({
      nodeEnv: "development",
      host: "0.0.0.0",
      port: 3001,
      logLevel: "info",
      yahooBaseUrl: "https://query1.finance.yahoo.com",
      yahooUserAgent: expect.stringContaining("Mozilla/5.0") as string,
      upstreamTotalTimeoutMs: 8000,
      upstreamAttemptTimeoutMs: 3000,
      upstreamRetries: 2,
      upstreamMaxRps: 2,
      upstreamCooldownSeconds: 30,
      cacheTtlSeconds: 60,
      cacheNotFoundTtlSeconds: 30,
      rateLimitPerMinute: 60,
      trustProxy: false,
      corsOrigins: [],
      clockFixedAt: null,
    });
  });

  it("reads overrides", () => {
    const c = load({
      PORT: "8080",
      LOG_LEVEL: "debug",
      UPSTREAM_RETRIES: "0",
      CACHE_TTL_SECONDS: "5",
    });

    expect(c).toMatchObject({
      port: 8080,
      logLevel: "debug",
      upstreamRetries: 0,
      cacheTtlSeconds: 5,
    });
  });

  it("treats empty values as unset, as a copied .env.example leaves them", () => {
    expect(load({ CORS_ORIGINS: "", CLOCK_FIXED_AT: "", TRUST_PROXY: "" })).toMatchObject({
      corsOrigins: [],
      clockFixedAt: null,
      trustProxy: false,
    });
  });

  it.each([
    ["PORT", "0"],
    ["PORT", "70000"],
    ["PORT", "abc"],
    ["UPSTREAM_TOTAL_TIMEOUT_MS", "-1"],
    ["UPSTREAM_ATTEMPT_TIMEOUT_MS", "1.5"],
    ["RATE_LIMIT_PER_MINUTE", "0"],
    ["LOG_LEVEL", "loud"],
    ["NODE_ENV", "staging"],
    ["YAHOO_BASE_URL", "not a url"],
    ["YAHOO_BASE_URL", "ftp://example.com"],
  ])("rejects %s=%j and names the variable", (name, value) => {
    expect(failure({ [name]: value })).toContain(name);
  });

  it("rejects an attempt timeout longer than the total deadline", () => {
    expect(
      failure({ UPSTREAM_TOTAL_TIMEOUT_MS: "2000", UPSTREAM_ATTEMPT_TIMEOUT_MS: "3000" }),
    ).toContain("UPSTREAM_ATTEMPT_TIMEOUT_MS");
  });

  describe("TRUST_PROXY (D-31, GHSA-3m5p-2c4r-xxw2)", () => {
    it.each([
      ["false", false],
      ["10.0.0.5", ["10.0.0.5"]],
      ["172.28.0.0/16", ["172.28.0.0/16"]],
      ["::1", ["::1"]],
      ["10.0.0.5, 10.0.0.6", ["10.0.0.5", "10.0.0.6"]],
    ])("accepts %j", (value, expected) => {
      expect(load({ TRUST_PROXY: value }).trustProxy).toEqual(expected);
    });

    it.each(["1", "2", "true", "*", "10.0.0.5/33", "10.0.0", "proxy.local"])(
      "rejects %j",
      (value) => {
        expect(failure({ TRUST_PROXY: value })).toContain("TRUST_PROXY");
      },
    );
  });

  describe("CLOCK_FIXED_AT (test only)", () => {
    it("is honored when NODE_ENV=test", () => {
      expect(
        load({ NODE_ENV: "test", CLOCK_FIXED_AT: "2026-11-05T21:30:00Z" }).clockFixedAt,
      ).toEqual(new Date("2026-11-05T21:30:00Z"));
    });

    it.each(["production", "development"])("refuses to start when set with NODE_ENV=%s", (env) => {
      expect(failure({ NODE_ENV: env, CLOCK_FIXED_AT: "2026-11-05T21:30:00Z" })).toContain(
        "CLOCK_FIXED_AT",
      );
    });

    it("rejects a value that is not an ISO instant", () => {
      expect(failure({ NODE_ENV: "test", CLOCK_FIXED_AT: "yesterday" })).toContain(
        "CLOCK_FIXED_AT",
      );
    });
  });

  describe("CORS_ORIGINS", () => {
    it("parses a comma-separated list of origins", () => {
      expect(
        load({ CORS_ORIGINS: "http://localhost:5173, https://app.example.com" }).corsOrigins,
      ).toEqual(["http://localhost:5173", "https://app.example.com"]);
    });

    it.each(["*", "localhost:5173", "https://app.example.com/path"])("rejects %j", (value) => {
      expect(failure({ CORS_ORIGINS: value })).toContain("CORS_ORIGINS");
    });
  });
});
