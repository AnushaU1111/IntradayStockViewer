/** Stable machine-readable `code` values in problem+json responses (spec section 3). */
export const ERROR_CODES = [
  "INVALID_SYMBOL",
  "SYMBOL_NOT_FOUND",
  "UNSUPPORTED_INSTRUMENT",
  "INTRADAY_UNAVAILABLE",
  "RATE_LIMITED",
  "SERVER_BUSY",
  "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_BLOCKED",
  "UPSTREAM_REJECTED",
  "UPSTREAM_BAD_RESPONSE",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "NOT_FOUND",
  "BAD_REQUEST",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** RFC 9457 problem details, as every non-2xx API response carries them. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ErrorCode;
  requestId: string;
}
