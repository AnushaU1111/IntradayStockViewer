// Cuts a captured Yahoo chart fixture down to what Yahoo would have returned
// for a request with the given period1 and period2 (period1 <= t < period2).
//
// Used by the A11 golden test and by the e2e fake Yahoo server, so both see the
// same bars for a given clock. Self-contained and limited to erasable TypeScript
// syntax so plain Node can import it directly (DECISIONS D-45).

export interface FixtureFile {
  capture: Record<string, unknown>;
  response: {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
    bodyText?: string;
  };
}

type Series = (number | null)[];

interface ChartResult {
  timestamp?: number[];
  indicators?: { quote?: Record<string, Series>[] };
  [key: string]: unknown;
}

export function sliceFixture(fixture: FixtureFile, period1: number, period2: number): FixtureFile {
  if (!Number.isSafeInteger(period1) || !Number.isSafeInteger(period2) || period1 > period2) {
    throw new RangeError(`invalid window: period1=${period1}, period2=${period2}`);
  }

  const copy = structuredClone(fixture);
  const body = copy.response.body as { chart?: { result?: ChartResult[] | null } } | undefined;
  const result = body?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  if (result === undefined || timestamps === undefined) return copy;

  const quote = result.indicators?.quote?.[0] ?? {};
  for (const [field, series] of Object.entries(quote)) {
    if (series.length !== timestamps.length) {
      throw new Error(
        `fixture arrays misaligned: timestamp has ${timestamps.length}, ${field} has ${series.length}`,
      );
    }
  }

  const inWindow = (i: number): boolean => {
    const t = timestamps[i];
    return t !== undefined && t >= period1 && t < period2;
  };
  result.timestamp = timestamps.filter((_, i) => inWindow(i));
  for (const [field, series] of Object.entries(quote)) {
    quote[field] = series.filter((_, i) => inWindow(i));
  }

  return copy;
}
