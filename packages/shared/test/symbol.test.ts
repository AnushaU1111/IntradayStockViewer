import { describe, expect, it } from "vitest";

import { SYMBOL_MAX_LENGTH, parseSymbol } from "../src/symbol.js";

const accepted = (raw: string) => {
  const r = parseSymbol(raw);
  return r.ok ? r.symbol : null;
};
const reason = (raw: string) => {
  const r = parseSymbol(raw);
  return r.ok ? null : r.reason;
};

describe("parseSymbol", () => {
  describe("V1 normalization", () => {
    it("trims surrounding whitespace and uppercases", () => {
      expect(accepted("  tsla ")).toBe("TSLA");
      expect(accepted("\ttsla\n")).toBe("TSLA");
    });
  });

  describe("V2 valid Yahoo formats", () => {
    it.each([
      ["TSLA", "TSLA"],
      ["brk-b", "BRK-B"],
      ["^GSPC", "^GSPC"],
      ["M&M.NS", "M&M.NS"],
      ["0700.HK", "0700.HK"],
      ["RELIANCE.NS", "RELIANCE.NS"],
      ["EURUSD=X", "EURUSD=X"],
      ["A", "A"],
    ])("accepts %s as %s", (raw, symbol) => {
      expect(accepted(raw)).toBe(symbol);
    });
  });

  describe("V3 hostile or malformed input", () => {
    it.each(["", "   ", "\t"])("rejects blank input %j as empty", (raw) => {
      expect(reason(raw)).toBe("empty");
    });

    it.each([
      "../etc",
      "TSLA/",
      "TSLA;DROP",
      "TSLA' OR '1'='1",
      "<script>",
      "T SLA",
      "TSLA%00",
      "^",
      "^^GSPC",
      "-TSLA",
      ".TSLA",
      "=X",
    ])("rejects %j", (raw) => {
      expect(reason(raw)).toBe("invalid_characters");
    });
  });

  describe("V4 Unicode case-mapping bypass", () => {
    // Guard: these inputs really would become valid tickers if uppercased before
    // validation, so the tests below prove validation runs first.
    it("guard: naive uppercasing turns them into ASCII tickers", () => {
      expect("tſla".toUpperCase()).toBe("TSLA");
      expect("ıbm".toUpperCase()).toBe("IBM");
    });

    it.each(["tſla", "ıbm", "ＴＳＬＡ", "TSLA​", "TЅLA"])("rejects %j", (raw) => {
      expect(reason(raw)).toBe("invalid_characters");
    });
  });

  describe("V5 length boundary", () => {
    it("allows 32 characters and rejects 33, with or without a caret", () => {
      expect(SYMBOL_MAX_LENGTH).toBe(32);
      expect(accepted("A".repeat(32))).toBe("A".repeat(32));
      expect(reason("A".repeat(33))).toBe("too_long");
      expect(accepted(`^${"A".repeat(31)}`)).toBe(`^${"A".repeat(31)}`);
      expect(reason(`^${"A".repeat(32)}`)).toBe("too_long");
    });

    it("measures length after trimming", () => {
      expect(accepted(`  ${"A".repeat(32)}  `)).toBe("A".repeat(32));
    });
  });
});
