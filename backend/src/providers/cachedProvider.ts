import {
  DomainError,
  IntradayUnavailable,
  SymbolNotFound,
  UnsupportedInstrument,
} from "../domain/errors.js";
import type { MarketDataProvider, ProviderData } from "./marketDataProvider.js";

export interface CachedProviderOptions {
  /** TTL for provider data and for 422 results. */
  ttlSeconds: number;
  /** TTL for 404 results. */
  notFoundTtlSeconds: number;
  maxEntries: number;
  /** Clock passed to the provider; the request window ends here. */
  clock: () => Date;
  /** Monotonic clock in ms, for expiry. */
  nowMs?: () => number;
}

/** A provider answer plus how long a client may cache it (null: do not cache). */
export type LookupResult =
  | { readonly ok: true; readonly data: ProviderData; readonly maxAgeSeconds: number }
  | { readonly ok: false; readonly error: DomainError; readonly maxAgeSeconds: number | null };

export interface CachedProvider {
  lookup(symbol: string): Promise<LookupResult>;
}

type Stored =
  | { readonly ok: true; readonly data: ProviderData; readonly expiresAt: number }
  | { readonly ok: false; readonly error: DomainError; readonly expiresAt: number };

/**
 * Caches provider data, never finished responses, so the service recomputes the
 * window and partial day from the current clock on every request (D-30 v3).
 * Only data, 404s and 422s are stored; every other failure goes straight through.
 */
export function createCachedProvider(
  inner: MarketDataProvider,
  options: CachedProviderOptions,
): CachedProvider {
  const {
    ttlSeconds,
    notFoundTtlSeconds,
    maxEntries,
    clock,
    nowMs = () => performance.now(),
  } = options;
  const entries = new Map<string, Stored>();

  const ttlFor = (err: DomainError): number | null => {
    if (err instanceof SymbolNotFound) return notFoundTtlSeconds;
    if (err instanceof UnsupportedInstrument || err instanceof IntradayUnavailable)
      return ttlSeconds;
    return null;
  };

  const store = (symbol: string, entry: Stored) => {
    entries.delete(symbol);
    entries.set(symbol, entry);
    // Map keeps insertion order, so the first key is the least recently used.
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(oldest);
    }
  };

  const fromEntry = (entry: Stored, now: number): LookupResult => {
    const maxAgeSeconds = Math.ceil((entry.expiresAt - now) / 1000);
    return entry.ok
      ? { ok: true, data: entry.data, maxAgeSeconds }
      : { ok: false, error: entry.error, maxAgeSeconds };
  };

  return {
    async lookup(symbol) {
      const now = nowMs();
      const hit = entries.get(symbol);
      if (hit !== undefined && hit.expiresAt > now) {
        store(symbol, hit); // refresh recency
        return fromEntry(hit, now);
      }
      entries.delete(symbol);

      try {
        const data = await inner.fetchIntraday(symbol, clock());
        const entry: Stored = { ok: true, data, expiresAt: nowMs() + ttlSeconds * 1000 };
        store(symbol, entry);
        return fromEntry(entry, nowMs());
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        const ttl = ttlFor(err);
        if (ttl === null) return { ok: false, error: err, maxAgeSeconds: null };
        const entry: Stored = { ok: false, error: err, expiresAt: nowMs() + ttl * 1000 };
        store(symbol, entry);
        return fromEntry(entry, nowMs());
      }
    },
  };
}
