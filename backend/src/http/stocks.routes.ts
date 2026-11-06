import { API_VERSION, HEADERS, parseSymbol, type SymbolRejection } from "@isv/shared";
import type { FastifyPluginAsync } from "fastify";

import type { DailySummaryService } from "../services/dailySummary.service.js";
import { HttpProblem, problemForDomainError, sendProblem, type ProblemOptions } from "./problem.js";

const INVALID_SYMBOL_DETAIL: Record<SymbolRejection, string> = {
  empty: "Enter a stock symbol.",
  too_long: "A symbol can be at most 32 characters.",
  invalid_characters:
    "A symbol may contain only letters, digits and . & = - , and may start with ^ (for example TSLA, BRK-B or ^GSPC).",
};

const dailySummarySchema = {
  200: {
    type: "array",
    items: {
      type: "object",
      required: ["day", "lowAverage", "highAverage", "volume"],
      additionalProperties: false,
      properties: {
        day: { type: "string" },
        lowAverage: { type: "number" },
        highAverage: { type: "number" },
        volume: { type: "integer" },
      },
    },
  },
} as const;

export interface StocksRoutesOptions extends ProblemOptions {
  service: DailySummaryService;
}

export const stocksRoutes: FastifyPluginAsync<StocksRoutesOptions> = (app, options) => {
  const { service } = options;

  app.get<{ Params: { symbol: string } }>(
    `/api/${API_VERSION}/stocks/:symbol/daily-summary`,
    { schema: { response: dailySummarySchema } },
    async (request, reply) => {
      const parsed = parseSymbol(request.params.symbol);
      if (!parsed.ok) {
        throw new HttpProblem({
          code: "INVALID_SYMBOL",
          detail: INVALID_SYMBOL_DETAIL[parsed.reason],
        });
      }

      const result = await service.getDailySummary(parsed.symbol);
      if (!result.ok) {
        const problem = problemForDomainError(result.error, parsed.symbol);
        request.log.info(
          { symbol: parsed.symbol, code: problem.code },
          "daily summary unavailable",
        );
        return sendProblem(
          request,
          reply,
          { ...problem, maxAgeSeconds: result.maxAgeSeconds },
          options,
        );
      }

      const { meta } = result;
      reply.header("cache-control", `public, max-age=${result.maxAgeSeconds}`);
      reply.header(HEADERS.exchangeTimezone, meta.timeZone);
      if (meta.currency !== null) reply.header(HEADERS.currency, meta.currency);
      if (meta.partialDay !== null) reply.header(HEADERS.partialDay, meta.partialDay);
      return result.days;
    },
  );

  return Promise.resolve();
};
