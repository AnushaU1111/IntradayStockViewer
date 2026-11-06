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

export class ProviderRateLimited extends DomainError {
  readonly code = "UPSTREAM_RATE_LIMITED";

  constructor(readonly retryAfterSeconds: number) {
    super(`provider rate limited; retry after ${retryAfterSeconds}s`);
  }
}

export class ProviderBlocked extends DomainError {
  readonly code = "UPSTREAM_BLOCKED";

  constructor(readonly retryAfterSeconds: number) {
    super(`provider refused access; retry after ${retryAfterSeconds}s`);
  }
}

export class ProviderRejected extends DomainError {
  readonly code = "UPSTREAM_REJECTED";
}

export class ProviderUnavailable extends DomainError {
  readonly code = "UPSTREAM_UNAVAILABLE";
}

export class ProviderTimeout extends DomainError {
  readonly code = "UPSTREAM_TIMEOUT";
}

export class ProviderBadResponse extends DomainError {
  readonly code = "UPSTREAM_BAD_RESPONSE";
}
