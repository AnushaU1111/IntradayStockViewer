import { Decimal } from "decimal.js";

// Enough precision that division never rounds before the final 4-place step.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * Mean rounded once to 4 decimal places, half up (DECISIONS D-19).
 * Each number enters as its shortest decimal string, so 249.9600067138672 is taken
 * as received and sums carry no binary error.
 */
export function mean4(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("mean of an empty list");

  const sum = values.reduce((acc, v) => acc.plus(v), new D(0));
  const rounded = sum.div(values.length).toDecimalPlaces(4, D.ROUND_HALF_UP).toNumber();
  return Object.is(rounded, -0) ? 0 : rounded;
}
