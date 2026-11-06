import type { DailySummaryResult } from "../api/client";
import { useCountUp } from "../hooks/useCountUp";
import { formatDayShort, formatPrice, formatRange, zoneCity } from "../lib/format";

import "./Results.css";

export function ResultsHeader({ result }: { result: DailySummaryResult }) {
  const { symbol, days, currency, timeZone, partialDay } = result;
  const first = days[0];
  const last = days.at(-1);
  const shown = useCountUp(last?.highAverage ?? 0);
  if (!first || !last) return null;
  const lastIsPartial = partialDay === last.day;

  return (
    <div className="results-head">
      <div>
        <div className="ticker">
          <h2>{symbol}</h2>
          {currency !== null && <span className="currency">{currency}</span>}
        </div>
        <ul className="meta" aria-label="About these results">
          {timeZone !== null && (
            <li>
              Days in <span title={timeZone}>{zoneCity(timeZone)} time</span>
              <span className="sr-only"> ({timeZone})</span>
            </li>
          )}
          <li>{formatRange(first.day, last.day)}</li>
          <li>
            {days.length} trading {days.length === 1 ? "day" : "days"}
          </li>
        </ul>
      </div>
      <div className="latest">
        <p className="latest-label">
          {lastIsPartial && <span className="live-badge">Still trading</span>}
          Avg high · {formatDayShort(last.day)}
          {lastIsPartial ? " so far" : ""}
        </p>
        <p className="latest-value num">
          <span aria-hidden="true">{formatPrice(shown)}</span>
          <span className="sr-only">{formatPrice(last.highAverage)}</span>
        </p>
      </div>
    </div>
  );
}
