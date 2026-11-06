import { useCallback, useEffect, useState } from "react";

interface Hold {
  until: number;
  error: unknown;
}

/**
 * Countdowns after a 429 or 503, one per symbol (spec 5.3, R4-#3). A held
 * symbol is not requested again until its countdown ends; every other symbol
 * goes out at once.
 */
export function useHolds() {
  const [holds, setHolds] = useState<ReadonlyMap<string, Hold>>(() => new Map());
  const [now, setNow] = useState(() => Date.now());

  const hold = useCallback((symbol: string, seconds: number, error: unknown) => {
    const start = Date.now();
    setNow(start);
    setHolds((prev) => new Map(prev).set(symbol, { until: start + seconds * 1000, error }));
  }, []);

  const active = [...holds.values()].some((h) => h.until > now);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(id);
    };
  }, [active]);

  /** Whole seconds left, rounded up, as shown to the user. */
  const remaining = (symbol: string): number => {
    const h = holds.get(symbol);
    return h ? Math.max(0, Math.ceil((h.until - now) / 1000)) : 0;
  };

  return {
    hold,
    remaining,
    /** Checked against the real clock, so a submit right at the end is not refused by a stale tick. */
    isHeld: (symbol: string): boolean => (holds.get(symbol)?.until ?? 0) > Date.now(),
    errorFor: (symbol: string): unknown => holds.get(symbol)?.error,
  };
}
