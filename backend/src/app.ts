import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { HEADERS } from "@isv/shared";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "./config/env.js";
import { RateLimitExceeded, registerProblemHandlers } from "./http/problem.js";
import { stocksRoutes } from "./http/stocks.routes.js";
import { createCachedProvider } from "./providers/cachedProvider.js";
import { createUpstreamGuard } from "./providers/upstreamGuard.js";
import { createYahooProvider } from "./providers/yahoo/yahooClient.js";
import { createDailySummaryService } from "./services/dailySummary.service.js";

export interface AppDeps {
  config: AppConfig;
  /** Injected in tests to stand in for Yahoo; production uses the global fetch. */
  fetchFn?: typeof fetch;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Keeps a well-formed incoming X-Request-Id, otherwise mints one. Never echoes junk. */
function requestIdFor(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  return typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Composition root: the only place that knows how the pieces fit together. */
export async function buildApp({ config, fetchFn }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
    requestIdHeader: false,
    genReqId: requestIdFor,
    maxParamLength: 256,
  });

  const fixedAt = config.clockFixedAt;
  const clock = fixedAt === null ? () => new Date() : () => new Date(fixedAt);

  const yahoo = createYahooProvider({
    baseUrl: config.yahooBaseUrl,
    userAgent: config.yahooUserAgent,
    ...(fetchFn ? { fetchFn } : {}),
  });
  const guard = createUpstreamGuard(yahoo, {
    totalTimeoutMs: config.upstreamTotalTimeoutMs,
    attemptTimeoutMs: config.upstreamAttemptTimeoutMs,
    retries: config.upstreamRetries,
    cooldownFallbackSeconds: config.upstreamCooldownSeconds,
    onStateChange: (state) => {
      app.log.warn({ upstream: state }, "upstream guard state changed");
    },
  });
  const cache = createCachedProvider(guard, {
    ttlSeconds: config.cacheTtlSeconds,
    notFoundTtlSeconds: config.cacheNotFoundTtlSeconds,
    maxEntries: 500,
    clock,
  });
  const service = createDailySummaryService({ provider: cache, clock, logger: app.log });
  const problemOptions = { fallbackRetryAfterSeconds: config.upstreamCooldownSeconds };

  app.addHook("onRequest", (request, reply, done) => {
    reply.header(HEADERS.requestId, request.id);
    done();
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  });
  if (config.corsOrigins.length > 0) {
    await app.register(cors, {
      origin: config.corsOrigins,
      methods: ["GET"],
      exposedHeaders: Object.values(HEADERS),
    });
  }
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: 60_000,
    errorResponseBuilder: (_request, context) =>
      new RateLimitExceeded(Math.max(1, Math.ceil(context.ttl / 1000))),
  });

  registerProblemHandlers(app, problemOptions);

  // Liveness and readiness never call Yahoo, so an upstream outage cannot fail a deploy (D-35).
  app.get("/health/live", { config: { rateLimit: false } }, () => ({ status: "ok" }));
  app.get("/health/ready", { config: { rateLimit: false } }, () => ({ status: "ready" }));

  await app.register(stocksRoutes, { service, ...problemOptions });
  // Not ready()'d here: listen() and inject() do that, and tests may add routes first.
  return app;
}
