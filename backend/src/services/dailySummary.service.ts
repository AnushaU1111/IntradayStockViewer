import type { DailySummary } from "@isv/shared";

import { aggregateDaily } from "../domain/aggregateDaily.js";
import { DomainError } from "../domain/errors.js";
import { partialDay } from "../domain/partialDay.js";
import type { CachedProvider } from "../providers/cachedProvider.js";

/** The parts of a logger the service uses; pino's logger satisfies it. */
export interface ServiceLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface DailySummaryMeta {
  timeZone: string;
  currency: string | null;
  partialDay: string | null;
}

export type DailySummaryResult =
  | {
      readonly ok: true;
      readonly days: DailySummary[];
      readonly meta: DailySummaryMeta;
      readonly maxAgeSeconds: number;
    }
  | { readonly ok: false; readonly error: DomainError; readonly maxAgeSeconds: number | null };

export interface DailySummaryService {
  /** Expects a symbol already validated and normalized by parseSymbol. */
  getDailySummary(symbol: string): Promise<DailySummaryResult>;
}

export interface DailySummaryServiceDeps {
  provider: CachedProvider;
  clock: () => Date;
  logger: ServiceLogger;
}

/**
 * Orchestrates provider then domain. Aggregation runs on every request against the
 * current clock, so cached provider data never carries a stale window or partial day.
 */
export function createDailySummaryService(deps: DailySummaryServiceDeps): DailySummaryService {
  const { provider, clock, logger } = deps;

  return {
    async getDailySummary(symbol) {
      const lookup = await provider.lookup(symbol);
      if (!lookup.ok) return lookup;

      const now = clock();
      const { bars, info, outsideSession } = lookup.data;
      try {
        const { days, diagnostics } = aggregateDaily(bars, info, now);

        const excluded = Object.values(diagnostics).some((count) => count > 0);
        if (excluded) {
          logger.warn(
            { symbol, ...diagnostics, outsideSession },
            "bars excluded from the daily summary",
          );
        }

        return {
          ok: true,
          days,
          meta: {
            timeZone: info.timeZone,
            currency: info.currency,
            partialDay: partialDay(now, info),
          },
          maxAgeSeconds: lookup.maxAgeSeconds,
        };
      } catch (err) {
        if (err instanceof DomainError) return { ok: false, error: err, maxAgeSeconds: null };
        throw err;
      }
    },
  };
}
