import { ApiError } from "../api/client";

/** Used when a 429 or 503 arrives without a readable Retry-After (spec 5.3). */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

export interface ErrorView {
  /** Shown in the results area. Never raw server text: every string comes from the code. */
  title: string;
  detail: string | null;
  /** countdown: Retry is held until Retry-After passes. now: Retry at once. none: retrying cannot help. */
  retry: "countdown" | "now" | "none";
  /** Seconds the countdown started from, for the one-time announcement. */
  countdownSeconds: number | null;
  /** True when the message belongs next to the input instead of in the results area. */
  field: boolean;
}

const UNAVAILABLE = "Market data is temporarily unavailable.";

export function holdSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.http === null) return null;
  const { status, retryAfterSeconds } = error.http;
  if (status !== 429 && status !== 503) return null;
  return retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
}

export function describeError(error: unknown, symbol: string): ErrorView {
  const view = (
    title: string,
    retry: ErrorView["retry"],
    detail: string | null = null,
  ): ErrorView => ({
    title,
    detail,
    retry,
    countdownSeconds: null,
    field: false,
  });

  if (!(error instanceof ApiError)) return view(UNAVAILABLE, "now");
  switch (error.kind) {
    case "timeout":
    case "network":
      return view("Can't reach the server.", "now", "Check your connection, then try again.");
    case "bad_response":
    case "cancelled":
      return view(UNAVAILABLE, "now");
    case "http":
      break;
  }

  const http = error.http;
  if (http === null) return view(UNAVAILABLE, "now");
  const seconds = holdSeconds(error);
  if (seconds !== null) {
    const title =
      http.status === 429
        ? "You're searching too quickly."
        : http.code === "SERVER_BUSY"
          ? "The server is busy."
          : UNAVAILABLE;
    return { ...view(title, "countdown"), countdownSeconds: seconds };
  }

  switch (http.status) {
    case 400:
      return { ...view("That isn't a valid symbol.", "none"), field: true };
    case 404:
      return view(
        `We couldn't find ${symbol}.`,
        "none",
        "Check the ticker, for example TSLA, AAPL or ^GSPC.",
      );
    case 422:
      if (http.code === "INTRADAY_UNAVAILABLE")
        return view(`No 15-minute data for ${symbol}.`, "none");
      return view(unsupportedMessage(symbol, http.instrumentType), "none");
    case 502:
    case 504:
      return view(UNAVAILABLE, "now");
    default:
      return http.status >= 500
        ? view("Something went wrong on our side.", "now")
        : view("That request didn't work.", "now");
  }
}

const INSTRUMENT_NAMES: Record<string, string> = {
  MUTUALFUND: "mutual fund",
  CRYPTOCURRENCY: "cryptocurrency",
  CURRENCY: "currency pair",
  FUTURE: "futures contract",
  OPTION: "option",
  MONEYMARKET: "money market fund",
  ECNQUOTE: "ECN quote",
};

function unsupportedMessage(symbol: string, instrumentType: string | null): string {
  if (instrumentType === null)
    return `${symbol} isn't a stock, ETF or index, so it isn't supported.`;
  const name =
    INSTRUMENT_NAMES[instrumentType] ?? instrumentType.toLowerCase().replaceAll("_", " ");
  const article = /^[aeiou]/i.test(name) || name.startsWith("ECN") ? "an" : "a";
  return `${symbol} is ${article} ${name}; only stocks, ETFs and indices are supported.`;
}

/** What the live region says once when an error appears. The countdown itself is not announced each second. */
export function errorAnnouncement(view: ErrorView): string {
  const parts = [view.title];
  if (view.detail !== null) parts.push(view.detail);
  if (view.countdownSeconds !== null) parts.push(`Try again in ${view.countdownSeconds} seconds.`);
  return parts.join(" ");
}
