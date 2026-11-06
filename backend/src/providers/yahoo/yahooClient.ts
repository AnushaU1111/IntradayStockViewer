import {
  ProviderBadResponse,
  ProviderBlocked,
  ProviderRateLimited,
  ProviderRejected,
  ProviderTimeout,
  ProviderUnavailable,
  SymbolNotFound,
} from "../../domain/errors.js";
import type { MarketDataProvider, ProviderData } from "../marketDataProvider.js";
import { parseRetryAfter } from "./retryAfter.js";
import { mapYahooChart } from "./yahooMapper.js";

const LOOKBACK_SECONDS = 35 * 86_400;

export interface YahooProviderOptions {
  baseUrl: string;
  userAgent: string;
  fetchFn?: typeof fetch;
  /** Wall clock in ms, for Retry-After dates. */
  nowMs?: () => number;
}

const isNamedError = (e: unknown, name: string) =>
  typeof e === "object" && e !== null && "name" in e && e.name === name;

/**
 * One HTTP attempt against Yahoo's v8 chart endpoint. Retries, deadlines and
 * cooldowns live in the upstream guard, not here.
 */
export function createYahooProvider(options: YahooProviderOptions): MarketDataProvider {
  const { baseUrl, userAgent, fetchFn = fetch, nowMs = Date.now } = options;

  function buildUrl(symbol: string, now: Date): URL {
    const period2 = Math.floor(now.getTime() / 1000);
    const url = new URL(`/v8/finance/chart/${encodeURIComponent(symbol)}`, baseUrl);
    url.searchParams.set("interval", "15m");
    url.searchParams.set("period1", String(period2 - LOOKBACK_SECONDS));
    url.searchParams.set("period2", String(period2));
    url.searchParams.set("includePrePost", "false");
    return url;
  }

  async function send(
    url: URL,
    signal: AbortSignal | undefined,
  ): Promise<{ res: Response; text: string }> {
    try {
      const res = await fetchFn(url, {
        headers: { "User-Agent": userAgent, Accept: "application/json" },
        ...(signal ? { signal } : {}),
      });
      return { res, text: await res.text() };
    } catch (err) {
      if (isNamedError(err, "TimeoutError"))
        throw new ProviderTimeout("provider attempt timed out");
      if (isNamedError(err, "AbortError")) throw err; // the caller cancelled; not a provider failure
      throw new ProviderUnavailable(
        `provider unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    async fetchIntraday(symbol: string, now: Date, signal?: AbortSignal): Promise<ProviderData> {
      const { res, text } = await send(buildUrl(symbol, now), signal);
      const retryAfter = () => parseRetryAfter(res.headers.get("retry-after"), nowMs());
      const { status } = res;

      if (status === 404) throw new SymbolNotFound(`no data for ${symbol}`);
      if (status === 429) throw new ProviderRateLimited(retryAfter());
      if (status === 401 || status === 403) throw new ProviderBlocked(retryAfter());
      if (status >= 500) throw new ProviderUnavailable(`provider returned ${status}`);
      if (status >= 400) throw new ProviderRejected(`provider rejected the request with ${status}`);
      if (status !== 200) throw new ProviderBadResponse(`unexpected provider status ${status}`);

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ProviderBadResponse("provider returned a non-JSON body");
      }
      return mapYahooChart(body);
    },
  };
}
