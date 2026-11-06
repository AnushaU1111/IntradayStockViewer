import {
  DomainError,
  ProviderBlocked,
  ProviderRateLimited,
  ProviderTimeout,
  ProviderUnavailable,
} from "../domain/errors.js";
import type { MarketDataProvider, ProviderData } from "./marketDataProvider.js";

export interface UpstreamGuardOptions {
  /** One budget for every attempt and backoff of a request (D-27). */
  totalTimeoutMs: number;
  /** Cap per attempt; the probe uses it too. */
  attemptTimeoutMs: number;
  /** Extra attempts after the first, for 5xx, network errors and timeouts only. */
  retries: number;
  /** Cooldown when the provider gives no usable Retry-After, or after a failed probe. */
  cooldownFallbackSeconds: number;
  /** Backoff before each retry, before jitter. */
  backoffMs?: readonly number[];
  /** No attempt starts with less than this left in the budget. */
  minAttemptMs?: number;
  /** Retry-After for requests that arrive while the probe is in flight. */
  probeBusySeconds?: number;
  /** Monotonic clock in ms. */
  nowMs?: () => number;
  /** Source of jitter in [0, 1); backoff is scaled by 0.5 to 1.5. */
  random?: () => number;
  onStateChange?: (state: GuardState) => void;
}

type Cause = "rate_limited" | "blocked" | "unavailable";

export type GuardState =
  | { readonly kind: "closed" }
  | { readonly kind: "open"; readonly until: number; readonly cause: Cause }
  | { readonly kind: "halfOpen"; readonly cause: Cause };

const CLOSED: GuardState = { kind: "closed" };

const isRetryable = (err: unknown): err is ProviderUnavailable | ProviderTimeout =>
  err instanceof ProviderUnavailable || err instanceof ProviderTimeout;

/** The cooldown cause and length a block error asks for, or null for any other error. */
function blockOf(err: unknown, fallbackSeconds: number): { cause: Cause; seconds: number } | null {
  if (err instanceof ProviderRateLimited) {
    return { cause: "rate_limited", seconds: err.retryAfterSeconds ?? fallbackSeconds };
  }
  if (err instanceof ProviderBlocked) {
    return { cause: "blocked", seconds: err.retryAfterSeconds ?? fallbackSeconds };
  }
  return null;
}

/** The error a request gets while the guard keeps it away from the provider. */
function coolingDown(cause: Cause, seconds: number): DomainError {
  if (cause === "rate_limited") return new ProviderRateLimited(seconds);
  if (cause === "blocked") return new ProviderBlocked(seconds);
  return new ProviderUnavailable("provider is cooling down after repeated failures", seconds);
}

/**
 * Wraps a provider with one request deadline, bounded retries and a global cooldown
 * with a single half-open probe (D-27, D-28). Yahoo's limit applies to this server's
 * IP, so the state is shared by every symbol and every user.
 */
export function createUpstreamGuard(
  inner: MarketDataProvider,
  options: UpstreamGuardOptions,
): MarketDataProvider & { state(): GuardState } {
  const {
    totalTimeoutMs,
    attemptTimeoutMs,
    retries,
    cooldownFallbackSeconds,
    backoffMs = [200, 600],
    minAttemptMs = 1000,
    probeBusySeconds = 2,
    nowMs = () => performance.now(),
    random = Math.random,
    onStateChange,
  } = options;

  let state: GuardState = CLOSED;
  const setState = (next: GuardState) => {
    state = next;
    onStateChange?.(next);
  };
  const openFor = (cause: Cause, seconds: number): GuardState => ({
    kind: "open",
    until: nowMs() + seconds * 1000,
    cause,
  });

  /** One attempt that settles by its deadline even if the provider ignores the signal. */
  function attempt(
    symbol: string,
    now: Date,
    budgetMs: number,
    caller?: AbortSignal,
  ): Promise<ProviderData> {
    const timer = new AbortController();
    const id = setTimeout(() => {
      timer.abort(new DOMException("provider attempt timed out", "TimeoutError"));
    }, budgetMs);
    const signal = caller ? AbortSignal.any([caller, timer.signal]) : timer.signal;

    let cleanup = () => {
      clearTimeout(id);
    };
    return new Promise<ProviderData>((resolve, reject) => {
      const onAbort = () => {
        if (timer.signal.aborted) {
          reject(new ProviderTimeout(`provider attempt exceeded ${budgetMs} ms`));
        } else {
          const reason: unknown = caller?.reason;
          reject(reason instanceof Error ? reason : new DOMException("aborted", "AbortError"));
        }
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      cleanup = () => {
        clearTimeout(id);
        signal.removeEventListener("abort", onAbort);
      };
      inner.fetchIntraday(symbol, now, signal).then(resolve, reject);
    }).finally(() => {
      cleanup();
    });
  }

  async function withRetries(
    symbol: string,
    now: Date,
    caller?: AbortSignal,
  ): Promise<ProviderData> {
    const deadline = nowMs() + totalTimeoutMs;
    for (let i = 0; ; i += 1) {
      let failure: ProviderUnavailable | ProviderTimeout;
      try {
        return await attempt(symbol, now, Math.min(attemptTimeoutMs, deadline - nowMs()), caller);
      } catch (err) {
        const block = blockOf(err, cooldownFallbackSeconds);
        if (block) {
          setState(openFor(block.cause, block.seconds));
          throw coolingDown(block.cause, block.seconds);
        }
        if (!isRetryable(err) || i >= retries) throw err;
        failure = err;
      }

      const wait = (backoffMs[Math.min(i, backoffMs.length - 1)] ?? 0) * (0.5 + random());
      if (nowMs() + wait + minAttemptMs > deadline) throw failure;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  async function probe(
    cause: Cause,
    symbol: string,
    now: Date,
    caller?: AbortSignal,
  ): Promise<ProviderData> {
    setState({ kind: "halfOpen", cause });
    let next: GuardState | null = null;
    try {
      const data = await attempt(symbol, now, attemptTimeoutMs, caller);
      next = CLOSED;
      return data;
    } catch (err) {
      const block = blockOf(err, cooldownFallbackSeconds);
      if (block) {
        next = openFor(block.cause, block.seconds);
        throw coolingDown(block.cause, block.seconds);
      }
      if (isRetryable(err)) {
        next = openFor("unavailable", cooldownFallbackSeconds);
      } else if (err instanceof DomainError) {
        next = CLOSED; // any non-block answer proves the provider is serving again
      } else if (caller?.aborted) {
        next = openFor(cause, 0); // cancelled: we learned nothing, so the next request probes
      }
      throw err;
    } finally {
      // Anything unexpected leaves the guard open, never stuck half-open (H5d).
      setState(next ?? openFor("unavailable", cooldownFallbackSeconds));
    }
  }

  return {
    state: () => state,
    fetchIntraday(symbol, now, signal) {
      const current = state;
      if (current.kind === "halfOpen") {
        return Promise.reject(coolingDown(current.cause, probeBusySeconds));
      }
      if (current.kind === "open") {
        const left = current.until - nowMs();
        if (left > 0) return Promise.reject(coolingDown(current.cause, Math.ceil(left / 1000)));
        return probe(current.cause, symbol, now, signal);
      }
      return withRetries(symbol, now, signal);
    },
  };
}
