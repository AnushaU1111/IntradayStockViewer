import { describe, expect, it } from "vitest";

import { mean4 } from "../../src/domain/rounding.js";

// What a careless implementation would do: float sum, then Math.round.
const naive = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e4) / 1e4;

describe("mean4", () => {
  describe("R1 true ties that defeat float math", () => {
    it.each([
      { xs: [1.0, 1.0001], want: 1.0001 },
      { xs: [1.0002, 1.0003], want: 1.0003 },
    ])("rounds the mean of $xs half up to $want", ({ xs, want }) => {
      // Guard: float arithmetic gets this case wrong, so the test can fail.
      expect(naive(xs)).not.toBe(want);
      expect(mean4(xs)).toBe(want);
    });
  });

  describe("R2 values as received", () => {
    it("rounds float32 noise to the intended price", () => {
      expect(mean4([249.9600067138672])).toBe(249.96);
    });

    it("keeps values that already have 4 or fewer decimals", () => {
      expect(mean4([343.69])).toBe(343.69);
      expect(mean4([10, 12])).toBe(11);
    });

    it("rounds an exact decimal tie up", () => {
      expect(mean4([1.00005])).toBe(1.0001);
      expect(mean4([2.00004])).toBe(2);
    });
  });

  it("never returns negative zero", () => {
    expect(Object.is(mean4([-0.00001, 0]), -0)).toBe(false);
  });

  it("rejects an empty list instead of returning NaN", () => {
    expect(() => mean4([])).toThrow(RangeError);
  });
});
