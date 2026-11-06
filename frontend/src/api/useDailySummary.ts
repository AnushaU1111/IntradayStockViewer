import { skipToken, useQuery } from "@tanstack/react-query";

import { ApiError, getDailySummary } from "./client";
import type { DailySummaryResult } from "./client";

export const dailySummaryKey = (symbol: string) => ["daily-summary", symbol] as const;

interface Options {
  /** False while the symbol is held by a countdown, so no request goes out. */
  enabled: boolean;
  /** Called with every failed response, before the query settles into its error state. */
  onFailure?: (symbol: string, error: unknown) => void;
}

/**
 * One query per symbol. Changing the symbol removes the old query's only
 * observer, and TanStack Query aborts its fetch through the signal, so a slow
 * older response can never replace a newer one.
 */
/**
 * The retry policy (spec 5.3): only a network failure is retried, once.
 * Timeouts, bad responses and every HTTP error are shown as they are.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && error instanceof ApiError && error.kind === "network";
}

export function useDailySummary(symbol: string | null, { enabled, onFailure }: Options) {
  return useQuery<DailySummaryResult, ApiError>({
    queryKey: symbol === null ? ["daily-summary"] : dailySummaryKey(symbol),
    queryFn:
      symbol !== null && enabled
        ? async ({ signal }) => {
            try {
              return await getDailySummary(symbol, signal);
            } catch (e) {
              onFailure?.(symbol, e);
              throw e;
            }
          }
        : skipToken,
    retry: shouldRetry,
    retryDelay: 300,
  });
}
