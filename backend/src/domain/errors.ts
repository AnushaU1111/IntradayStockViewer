import type { ErrorCode } from "@isv/shared";

/** Base for every expected failure; the HTTP layer maps `code` to a status. */
export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SymbolNotFound extends DomainError {
  readonly code = "SYMBOL_NOT_FOUND";
}

export class UnsupportedInstrument extends DomainError {
  readonly code = "UNSUPPORTED_INSTRUMENT";

  constructor(readonly instrumentType: string) {
    super(`instrument type ${instrumentType} is not supported`);
  }
}

export class IntradayUnavailable extends DomainError {
  readonly code = "INTRADAY_UNAVAILABLE";

  constructor(readonly granularity: string) {
    super(`provider returned ${granularity} data instead of 15m`);
  }
}

/** `retryAfterSeconds` is null when the provider sent no usable Retry-After. */
export class ProviderRateLimited extends DomainError {
  readonly code = "UPSTREAM_RATE_LIMITED";

  constructor(readonly retryAfterSeconds: number | null) {
    super(`provider rate limited (retry after ${String(retryAfterSeconds)}s)`);
  }
}

export class ProviderBlocked extends DomainError {
  readonly code = "UPSTREAM_BLOCKED";

  constructor(readonly retryAfterSeconds: number | null) {
    super(`provider refused access (retry after ${String(retryAfterSeconds)}s)`);
  }
}

export class ProviderRejected extends DomainError {
  readonly code = "UPSTREAM_REJECTED";
}

/** `retryAfterSeconds` is set when the upstream guard is cooling down after failures. */
export class ProviderUnavailable extends DomainError {
  readonly code = "UPSTREAM_UNAVAILABLE";

  constructor(
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export class ProviderTimeout extends DomainError {
  readonly code = "UPSTREAM_TIMEOUT";
}

export class ProviderBadResponse extends DomainError {
  readonly code = "UPSTREAM_BAD_RESPONSE";
}
