import { dailySummaryPath, ERROR_CODES, HEADERS } from "@isv/shared";
import type { DailySummary, ErrorCode } from "@isv/shared";

/**
 * How a request ended without usable data (spec 5.3, DECISIONS D-40).
 * Only `network` is ever retried automatically, and only once.
 */
export type ApiErrorKind = "cancelled" | "timeout" | "network" | "bad_response" | "http";

export interface HttpErrorInfo {
  status: number;
  /** Problem `code`, or null when the body was not a problem we recognise. */
  code: ErrorCode | null;
  /** Whole seconds from `Retry-After`, or null when absent or unreadable. */
  retryAfterSeconds: number | null;
  /** Upper-case instrument type on UNSUPPORTED_INSTRUMENT, when it is well formed. */
  instrumentType: string | null;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly http: HttpErrorInfo | null;

  constructor(kind: ApiErrorKind, http: HttpErrorInfo | null = null) {
    super(http ? `${kind} ${http.status}` : kind);
    this.name = "ApiError";
    this.kind = kind;
    this.http = http;
  }
}

export interface DailySummaryResult {
  symbol: string;
  /** Oldest first, as the API returns them. */
  days: DailySummary[];
  /** IANA zone the days are keyed in, from X-Exchange-Timezone. */
  timeZone: string | null;
  /** ISO currency code from X-Currency, absent for some instruments. */
  currency: string | null;
  /** The one day still trading, from X-Partial-Day. The UI never works this out itself. */
  partialDay: string | null;
  requestId: string | null;
}

export interface ClientOptions {
  /** Longer than the API's own 8 s deadline, so the API answers first (spec 5.5). */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export const CLIENT_TIMEOUT_MS = 10_000;

export async function getDailySummary(
  symbol: string,
  signal: AbortSignal,
  { timeoutMs = CLIENT_TIMEOUT_MS, fetchFn = fetch }: ClientOptions = {},
): Promise<DailySummaryResult> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  let res: Response;
  // Only a rejection of fetch() itself is classified as cancelled, timeout or network.
  try {
    res = await fetchFn(dailySummaryPath(symbol), {
      signal: combined,
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    if (signal.aborted) throw new ApiError("cancelled");
    // Checked by name, not `instanceof DOMException`: the timeout's DOMException can
    // come from another realm (a test DOM, an extension) and fail instanceof.
    if (isNamed(e, "TimeoutError")) throw new ApiError("timeout");
    if (e instanceof TypeError) throw new ApiError("network");
    throw e;
  }
  // Reading and parsing the body is a separate step. A failure here, even a
  // TypeError, is a bad response and is never retried (DECISIONS D-40, R5-#6).
  try {
    return await parse(symbol, res);
  } catch (e) {
    if (signal.aborted) throw new ApiError("cancelled");
    if (e instanceof ApiError) throw e;
    throw new ApiError("bad_response");
  }
}

async function parse(symbol: string, res: Response): Promise<DailySummaryResult> {
  if (!res.ok) throw new ApiError("http", await readProblem(res));
  const body: unknown = await res.json();
  if (!Array.isArray(body) || !body.every(isDailySummary)) throw new ApiError("bad_response");
  return {
    symbol,
    days: body,
    timeZone: res.headers.get(HEADERS.exchangeTimezone),
    currency: res.headers.get(HEADERS.currency),
    partialDay: res.headers.get(HEADERS.partialDay),
    requestId: res.headers.get(HEADERS.requestId),
  };
}

async function readProblem(res: Response): Promise<HttpErrorInfo> {
  const info: HttpErrorInfo = {
    status: res.status,
    code: null,
    retryAfterSeconds: parseRetryAfter(res.headers.get("Retry-After")),
    instrumentType: null,
  };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return info; // The status alone still decides what the user sees.
  }
  if (typeof body !== "object" || body === null) return info;
  if ("code" in body && isErrorCode(body.code)) info.code = body.code;
  if (
    "instrumentType" in body &&
    typeof body.instrumentType === "string" &&
    INSTRUMENT_TYPE.test(body.instrumentType)
  ) {
    info.instrumentType = body.instrumentType;
  }
  return info;
}

/** The API sends delta-seconds. Anything else is unreadable, and the caller falls back. */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d{1,6}$/.test(value.trim())) return null;
  return Number(value.trim());
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTRUMENT_TYPE = /^[A-Z_]{1,32}$/;
const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value);
}

function isDailySummary(value: unknown): value is DailySummary {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.day === "string" &&
    DAY.test(v.day) &&
    isFiniteNumber(v.lowAverage) &&
    isFiniteNumber(v.highAverage) &&
    isFiniteNumber(v.volume) &&
    v.volume >= 0
  );
}

function isNamed(e: unknown, name: string): boolean {
  return typeof e === "object" && e !== null && "name" in e && e.name === name;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
