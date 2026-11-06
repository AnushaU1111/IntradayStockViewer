import { isValidTimeZone } from "../../domain/dayKey.js";
import {
  IntradayUnavailable,
  ProviderBadResponse,
  ProviderRejected,
  SymbolNotFound,
  UnsupportedInstrument,
} from "../../domain/errors.js";
import type { InstrumentType, IntradayBar } from "../../domain/types.js";
import type { ProviderData } from "../marketDataProvider.js";
import { yahooChartSchema, type YahooResult } from "./yahooSchema.js";

const IN_SCOPE: ReadonlySet<string> = new Set<InstrumentType>(["EQUITY", "ETF", "INDEX"]);
const isInScope = (type: string): type is InstrumentType => IN_SCOPE.has(type);

/**
 * Turns a parsed Yahoo chart body into domain data. The only code that knows
 * Yahoo's shape (D-32). Throws a DomainError for every rejected payload.
 */
export function mapYahooChart(body: unknown): ProviderData {
  const parsed = yahooChartSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderBadResponse(
      `unexpected chart shape: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }

  const { error, result } = parsed.data.chart;
  if (error) {
    if (error.code === "Not Found")
      throw new SymbolNotFound(error.description ?? "symbol not found");
    throw new ProviderRejected(`provider error ${error.code}`);
  }

  const chart = result?.[0];
  if (chart === undefined) throw new ProviderBadResponse("chart has neither a result nor an error");

  const { meta } = chart;
  // Granularity first: a mutual fund reports 1d data, and "no 15-minute data" is the
  // more useful answer for it than "unsupported instrument".
  if (meta.dataGranularity !== "15m") throw new IntradayUnavailable(meta.dataGranularity);
  if (!isInScope(meta.instrumentType)) throw new UnsupportedInstrument(meta.instrumentType);
  if (!isValidTimeZone(meta.exchangeTimezoneName)) {
    throw new ProviderBadResponse(`unknown exchange timezone ${meta.exchangeTimezoneName}`);
  }

  const { bars, outsideSession } = mapBars(chart);
  const regular = meta.currentTradingPeriod?.regular;
  return {
    bars,
    outsideSession,
    info: {
      timeZone: meta.exchangeTimezoneName,
      currency: meta.currency ?? null,
      instrumentType: meta.instrumentType,
      sessionStart: regular?.start ?? null,
      sessionEnd: regular?.end ?? null,
    },
  };
}

function mapBars(chart: YahooResult): { bars: IntradayBar[]; outsideSession: number } {
  const timestamps = chart.timestamp ?? [];
  const quote = chart.indicators?.quote[0];
  const { low, high, volume } = quote ?? {};

  if (timestamps.length === 0) {
    // Valid empty result only when there is no quote data either (R2-B).
    const hasQuoteData = [low, high, volume].some((s) => s !== undefined && s.length > 0);
    if (hasQuoteData) throw new ProviderBadResponse("quote data without timestamps");
    return { bars: [], outsideSession: 0 };
  }

  if (low === undefined || high === undefined || volume === undefined) {
    throw new ProviderBadResponse("timestamps without quote data");
  }
  const n = timestamps.length;
  if (low.length !== n || high.length !== n || volume.length !== n) {
    throw new ProviderBadResponse(
      `quote arrays misaligned: ${n} timestamps, ${low.length} lows, ${high.length} highs, ${volume.length} volumes`,
    );
  }

  const periods = chart.meta.tradingPeriods?.flat();
  if (periods === undefined || periods.length === 0) {
    throw new ProviderBadResponse("tradingPeriods missing for an intraday result");
  }
  const inSession = (t: number) => periods.some((p) => p.start <= t && t < p.end);

  const bars: IntradayBar[] = [];
  let outsideSession = 0;
  timestamps.forEach((t, i) => {
    if (!inSession(t)) {
      outsideSession += 1;
      return;
    }
    bars.push({ t, low: low[i] ?? null, high: high[i] ?? null, volume: volume[i] ?? null });
  });
  return { bars, outsideSession };
}
