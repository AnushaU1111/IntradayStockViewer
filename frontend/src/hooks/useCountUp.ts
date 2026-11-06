import { useEffect, useState } from "react";

import { useReducedMotion } from "./useReducedMotion";

/**
 * Rolls a number up to `target` once, for the headline value. Purely visual:
 * callers render the real value for assistive technology separately.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : target * 0.92);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const from = target * 0.92;
    let start: number | null = null;
    let frame = requestAnimationFrame(function step(t) {
      start ??= t;
      const k = Math.min(1, (t - start) / durationMs);
      setValue(from + (target - from) * (1 - (1 - k) ** 3));
      if (k < 1) frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, durationMs, reduced]);

  return value;
}
