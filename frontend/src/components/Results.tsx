import { useState } from "react";

import type { DailySummaryResult } from "../api/client";

import { ResultsChart } from "./ResultsChart";
import { ResultsHeader } from "./ResultsHeader";
import { ResultsTable } from "./ResultsTable";

/** Summary, chart and table, sharing one focused day. Keyed by symbol, so a new symbol starts on its latest day. */
export function Results({ result }: { result: DailySummaryResult }) {
  const { symbol, days, currency, partialDay } = result;
  const [focusIndex, setFocusIndex] = useState(days.length - 1);
  const focusDay = days[focusIndex]?.day ?? null;

  return (
    <>
      <ResultsHeader result={result} />
      <ResultsChart
        symbol={symbol}
        days={days}
        currency={currency}
        partialDay={partialDay}
        focusIndex={focusIndex}
        onFocusIndex={setFocusIndex}
      />
      <ResultsTable
        symbol={symbol}
        days={days}
        currency={currency}
        partialDay={partialDay}
        focusDay={focusDay}
        onFocusDay={(day) => {
          const i = days.findIndex((d) => d.day === day);
          if (i >= 0) setFocusIndex(i);
        }}
      />
    </>
  );
}
