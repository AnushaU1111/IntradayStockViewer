/** Longest accepted symbol, caret included (spec 4.2). */
export const SYMBOL_MAX_LENGTH = 32;

// ASCII only, checked on the raw input BEFORE any case change: uppercasing first
// would turn lookalikes such as "tſla" or "ıbm" into valid tickers (DECISIONS D-22).
const SYMBOL_PATTERN = /^\^?[A-Za-z0-9][A-Za-z0-9.&=-]*$/;

export type SymbolRejection = "empty" | "too_long" | "invalid_characters";

export type SymbolResult =
  | { readonly ok: true; readonly symbol: string }
  | { readonly ok: false; readonly reason: SymbolRejection };

/** Validates and normalizes a user-supplied ticker. Shared by the API and the UI. */
export function parseSymbol(raw: string): SymbolResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.length > SYMBOL_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (!SYMBOL_PATTERN.test(trimmed)) return { ok: false, reason: "invalid_characters" };
  return { ok: true, symbol: trimmed.toUpperCase() };
}
