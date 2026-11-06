/** Version segment of every API path, shared so the UI and API cannot drift. */
export const API_VERSION = "v1";

export function dailySummaryPath(symbol: string): string {
  return `/api/${API_VERSION}/stocks/${encodeURIComponent(symbol)}/daily-summary`;
}

export { HEADERS, type DailySummary } from "./dto.js";
export { ERROR_CODES, type ErrorCode, type ProblemDetails } from "./errorCodes.js";
export {
  SYMBOL_MAX_LENGTH,
  parseSymbol,
  type SymbolRejection,
  type SymbolResult,
} from "./symbol.js";
