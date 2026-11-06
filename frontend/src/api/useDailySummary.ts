import { skipToken, useQuery } from "@tanstack/react-query";

import { getDailySummary } from "./client";
import type { ApiError, DailySummaryResult } from "./client";

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
  });
}
