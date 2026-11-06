import { isIP } from "node:net";

import { z } from "zod";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

const int = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max);

/** One IP or CIDR. Numbers (hop counts) and "true" are rejected: see D-31. */
function isIpOrCidr(entry: string): boolean {
  const [address = "", prefix, ...rest] = entry.split("/");
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

const trustProxy = z
  .string()
  .default("false")
  .transform((value, ctx) => {
    if (value === "false") return false as const;
    const entries = value.split(",").map((e) => e.trim());
    if (entries.every(isIpOrCidr)) return entries;
    ctx.addIssue({
      code: "custom",
      message:
        "must be false or a comma-separated list of IP addresses or CIDR ranges (no hop counts)",
    });
    return z.NEVER;
  });

const corsOrigins = z
  .string()
  .default("")
  .transform((value, ctx) => {
    const entries = value
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e !== "");
    const valid = entries.every((e) => {
      try {
        const url = new URL(e);
        return (url.protocol === "http:" || url.protocol === "https:") && url.origin === e;
      } catch {
        return false;
      }
    });
    if (valid) return entries;
    ctx.addIssue({
      code: "custom",
      message: "must be a comma-separated list of origins like https://app.example.com",
    });
    return z.NEVER;
  });

const httpUrl = z.string().refine((v) => {
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}, "must be an http or https URL");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: int(1, 65_535).default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    YAHOO_BASE_URL: httpUrl.default("https://query1.finance.yahoo.com"),
    YAHOO_USER_AGENT: z.string().min(1).default(DEFAULT_USER_AGENT),
    UPSTREAM_TOTAL_TIMEOUT_MS: int(1).default(8000),
    UPSTREAM_ATTEMPT_TIMEOUT_MS: int(1).default(3000),
    UPSTREAM_RETRIES: int(0, 10).default(2),
    UPSTREAM_MAX_RPS: int(1).default(2),
    UPSTREAM_COOLDOWN_SECONDS: int(1).default(30),
    CACHE_TTL_SECONDS: int(1).default(60),
    CACHE_NOT_FOUND_TTL_SECONDS: int(1).default(30),
    RATE_LIMIT_PER_MINUTE: int(1).default(60),
    TRUST_PROXY: trustProxy,
    CORS_ORIGINS: corsOrigins,
    CLOCK_FIXED_AT: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.UPSTREAM_ATTEMPT_TIMEOUT_MS > env.UPSTREAM_TOTAL_TIMEOUT_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["UPSTREAM_ATTEMPT_TIMEOUT_MS"],
        message: "must not exceed UPSTREAM_TOTAL_TIMEOUT_MS",
      });
    }
    if (env.CLOCK_FIXED_AT !== undefined && env.NODE_ENV !== "test") {
      ctx.addIssue({
        code: "custom",
        path: ["CLOCK_FIXED_AT"],
        message: "is only allowed when NODE_ENV=test",
      });
    }
  });

export type AppConfig = ReturnType<typeof toConfig>;

function toConfig(env: z.infer<typeof schema>) {
  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    yahooBaseUrl: env.YAHOO_BASE_URL,
    yahooUserAgent: env.YAHOO_USER_AGENT,
    upstreamTotalTimeoutMs: env.UPSTREAM_TOTAL_TIMEOUT_MS,
    upstreamAttemptTimeoutMs: env.UPSTREAM_ATTEMPT_TIMEOUT_MS,
    upstreamRetries: env.UPSTREAM_RETRIES,
    upstreamMaxRps: env.UPSTREAM_MAX_RPS,
    upstreamCooldownSeconds: env.UPSTREAM_COOLDOWN_SECONDS,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,
    cacheNotFoundTtlSeconds: env.CACHE_NOT_FOUND_TTL_SECONDS,
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
    trustProxy: env.TRUST_PROXY,
    corsOrigins: env.CORS_ORIGINS,
    clockFixedAt: env.CLOCK_FIXED_AT === undefined ? null : new Date(env.CLOCK_FIXED_AT),
  };
}

/**
 * Validates the environment once at startup. Empty values count as unset, so a copied
 * .env.example behaves like no .env at all. Throws ConfigError naming every bad variable.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const present = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
    throw new ConfigError(`Invalid configuration: ${problems.join("; ")}`);
  }
  return toConfig(parsed.data);
}
