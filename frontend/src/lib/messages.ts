import type { SymbolRejection } from "@isv/shared";

export function rejectionMessage(reason: SymbolRejection): string {
  switch (reason) {
    case "empty":
      return "Enter a symbol, for example TSLA or ^GSPC.";
    case "too_long":
      return "Symbols are at most 32 characters.";
    case "invalid_characters":
      return "Use letters, digits and . & = - only, with an optional leading ^.";
  }
}
