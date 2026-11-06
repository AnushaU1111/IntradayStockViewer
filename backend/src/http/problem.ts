import { STATUS_CODES } from "node:http";

import type { ErrorCode, ProblemDetails } from "@isv/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  DomainError,
  ProviderBlocked,
  ProviderRateLimited,
  ProviderUnavailable,
  UnsupportedInstrument,
} from "../domain/errors.js";

const STATUS: Record<ErrorCode, number> = {
  INVALID_SYMBOL: 400,
  BAD_REQUEST: 400,
  SYMBOL_NOT_FOUND: 404,
  NOT_FOUND: 404,
  UNSUPPORTED_INSTRUMENT: 422,
  INTRADAY_UNAVAILABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UPSTREAM_REJECTED: 502,
  UPSTREAM_BAD_RESPONSE: 502,
  UPSTREAM_UNAVAILABLE: 502,
  SERVER_BUSY: 503,
  UPSTREAM_RATE_LIMITED: 503,
  UPSTREAM_BLOCKED: 503,
  UPSTREAM_TIMEOUT: 504,
};

export interface Problem {
  code: ErrorCode;
  detail: string;
  /** Overrides the code's default status (framework 4xx errors keep their own). */
  status?: number;
  retryAfterSeconds?: number | null;
  /** Seconds a client may cache this answer; absent or null means no-store. */
  maxAgeSeconds?: number | null;
  instrumentType?: string;
}

/** Thrown by the rate-limit plugin's errorResponseBuilder, handled by the error handler. */
export class RateLimitExceeded extends Error {
  readonly statusCode = 429;

  constructor(readonly retryAfterSeconds: number) {
    super("rate limit exceeded");
  }
}

/** An expected client-facing failure raised by a route, such as an invalid symbol. */
export class HttpProblem extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail);
  }
}

// Share classes like BRK.B are written BRK-B on Yahoo (D-24).
const SHARE_CLASS = /^([A-Z]{1,5})\.([A-Z])$/;

/** The client-facing answer for a domain error. Messages never include upstream text. */
export function problemForDomainError(error: DomainError, symbol?: string): Problem {
  const subject = symbol ?? "this symbol";
  switch (error.code) {
    case "SYMBOL_NOT_FOUND": {
      const m = symbol === undefined ? null : SHARE_CLASS.exec(symbol);
      const hint = m
        ? ` Yahoo writes share classes with a hyphen, for example ${m[1] ?? ""}-${m[2] ?? ""}.`
        : "";
      return { code: error.code, detail: `No market data found for ${subject}.${hint}` };
    }
    case "UNSUPPORTED_INSTRUMENT": {
      const type = error instanceof UnsupportedInstrument ? error.instrumentType : "UNKNOWN";
      return {
        code: error.code,
        detail: `${subject} is a ${type.toLowerCase()}; only stocks, ETFs and indices are supported.`,
        instrumentType: type,
      };
    }
    case "INTRADAY_UNAVAILABLE":
      return { code: error.code, detail: `No 15-minute data is available for ${subject}.` };
    case "UPSTREAM_RATE_LIMITED":
      return {
        code: error.code,
        detail: "The market data provider is limiting requests. Try again later.",
        retryAfterSeconds: error instanceof ProviderRateLimited ? error.retryAfterSeconds : null,
      };
    case "UPSTREAM_BLOCKED":
      return {
        code: error.code,
        detail: "The market data provider refused the request. Try again later.",
        retryAfterSeconds: error instanceof ProviderBlocked ? error.retryAfterSeconds : null,
      };
    case "UPSTREAM_UNAVAILABLE": {
      const retryAfterSeconds =
        error instanceof ProviderUnavailable ? error.retryAfterSeconds : null;
      return {
        code: error.code,
        detail: "The market data provider is unavailable.",
        // While the guard cools down after failed probes, this is a 503 with Retry-After (D-54).
        ...(retryAfterSeconds === null ? {} : { status: 503, retryAfterSeconds }),
      };
    }
    case "UPSTREAM_REJECTED":
      return { code: error.code, detail: "The market data provider rejected the request." };
    case "UPSTREAM_TIMEOUT":
      return { code: error.code, detail: "The market data provider did not respond in time." };
    case "UPSTREAM_BAD_RESPONSE":
      return {
        code: error.code,
        detail: "The market data provider returned data that could not be used.",
      };
    default:
      return { code: "INTERNAL_ERROR", detail: "Something went wrong on our side." };
  }
}

export interface ProblemOptions {
  /** Retry-After for a 429 or 503 whose cause gave none, so the header is never missing. */
  fallbackRetryAfterSeconds: number;
}

export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  problem: Problem,
  options: ProblemOptions,
): FastifyReply {
  const status = problem.status ?? STATUS[problem.code];
  const body: ProblemDetails = {
    type: "about:blank",
    title: STATUS_CODES[status] ?? "Error",
    status,
    detail: problem.detail,
    code: problem.code,
    requestId: request.id,
    ...(problem.instrumentType === undefined ? {} : { instrumentType: problem.instrumentType }),
  };

  reply
    .code(status)
    .type("application/problem+json")
    .header(
      "cache-control",
      problem.maxAgeSeconds === undefined || problem.maxAgeSeconds === null
        ? "no-store"
        : `public, max-age=${problem.maxAgeSeconds}`,
    );
  if (status === 429 || status === 503) {
    reply.header(
      "retry-after",
      String(problem.retryAfterSeconds ?? options.fallbackRetryAfterSeconds),
    );
  }
  return reply.send(body);
}

const statusOf = (error: unknown): number | null => {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;
  return typeof error.statusCode === "number" ? error.statusCode : null;
};

/** Makes every non-2xx response problem+json, including Fastify's own (H10). */
export function registerProblemHandlers(app: FastifyInstance, options: ProblemOptions): void {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, { code: "NOT_FOUND", detail: "No such endpoint." }, options),
  );

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof RateLimitExceeded) {
      return sendProblem(
        request,
        reply,
        {
          code: "RATE_LIMITED",
          detail: `Too many requests. Try again in ${error.retryAfterSeconds} seconds.`,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        options,
      );
    }
    if (error instanceof HttpProblem) return sendProblem(request, reply, error.problem, options);
    if (error instanceof DomainError)
      return sendProblem(request, reply, problemForDomainError(error), options);

    const status = statusOf(error);
    if (status !== null && status >= 400 && status < 500) {
      request.log.info({ err: error }, "rejected malformed request");
      return sendProblem(
        request,
        reply,
        { code: "BAD_REQUEST", status, detail: "The request was malformed." },
        options,
      );
    }

    request.log.error({ err: error }, "unhandled error");
    return sendProblem(
      request,
      reply,
      { code: "INTERNAL_ERROR", detail: "Something went wrong on our side." },
      options,
    );
  });
}
