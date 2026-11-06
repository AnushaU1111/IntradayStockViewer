import { QueryClient } from "@tanstack/react-query";

/**
 * The backend owns retries (spec 5.3), so queries never retry by default and
 * never refetch behind the user's back. useDailySummary opts in to the one
 * retry the spec allows.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000, // matches the API's Cache-Control max-age for data
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}
