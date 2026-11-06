/** A "nice" tick step (1, 2, 2.5 or 5 times a power of ten) giving about `count` ticks. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0)) return 1;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const n = raw / power;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * power;
}

/** Fewest decimals (0 to 4) that print `step` exactly. */
export function stepDecimals(step: number): number {
  for (let d = 0; d < 4; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return d;
  }
  return 4;
}

export interface PriceScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
  decimals: number;
}

/** Ticks covering [lo, hi] with a little headroom, so bars never touch the frame. */
export function priceScale(lo: number, hi: number, count = 5): PriceScale {
  const span = hi - lo;
  const pad = span > 0 ? span * 0.08 : Math.max(Math.abs(hi) * 0.01, 0.0001);
  const step = niceStep(span + 2 * pad, count);
  const min = Math.floor((lo - pad) / step) * step;
  const max = Math.ceil((hi + pad) / step) * step;
  const ticks: number[] = [];
  for (let i = 0; min + i * step <= max + step / 1e6; i++) ticks.push(min + i * step);
  return { min, max, step, ticks, decimals: stepDecimals(step) };
}
