import type { InstrumentInfo, IntradayBar } from "../domain/types.js";

/** Bars and instrument details for one symbol, as the provider received them. */
export interface ProviderData {
  bars: IntradayBar[];
  info: InstrumentInfo;
  /** Bars the provider dropped for falling outside a regular session (D-50). */
  outsideSession: number;
}

/**
 * The only thing the service knows about market data. Implementations throw
 * DomainError subclasses for every expected failure.
 */
export interface MarketDataProvider {
  /** Fetches the trailing 35 days of 15-minute bars ending at `now`. */
  fetchIntraday(symbol: string, now: Date, signal?: AbortSignal): Promise<ProviderData>;
}
