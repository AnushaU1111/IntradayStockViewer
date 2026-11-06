import { useId, useState } from "react";

import type { DailySummary } from "@isv/shared";

import { formatDayLong, formatPrice, formatVolume, spread } from "../lib/format";

import "./Results.css";

const COLLAPSED_ROWS = 8;

interface Props {
  symbol: string;
  days: readonly DailySummary[];
  currency: string | null;
  partialDay: string | null;
  focusDay?: string | null;
  onFocusDay?: (day: string) => void;
}

/** Every day in the window, newest first. Also the chart's text alternative (spec 5.2). */
export function ResultsTable({
  symbol,
  days,
  currency,
  partialDay,
  focusDay = null,
  onFocusDay,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const captionId = useId();
  const tableId = useId();
  const newestFirst = [...days].reverse();
  const visible = expanded ? newestFirst : newestFirst.slice(0, COLLAPSED_ROWS);
  const unit = currency === null ? "" : ` in ${currency}`;

  return (
    <section className="card" aria-labelledby={captionId}>
      <div className="table-head">
        <h3 id={captionId}>Daily summary</h3>
        <p>Newest first · averages of 15-minute bars</p>
      </div>
      <div className="table-scroll" tabIndex={0} aria-labelledby={captionId}>
        <table className="days" id={tableId}>
          <caption className="sr-only">
            {symbol} daily averages{unit}, newest first.
          </caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Avg low</th>
              <th scope="col">Avg high</th>
              <th scope="col">Spread</th>
              <th scope="col">Volume</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d, i) => (
              <tr
                key={d.day}
                data-focus={d.day === focusDay}
                style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                onPointerEnter={() => onFocusDay?.(d.day)}
              >
                <th scope="row">
                  <span className="day-cell">
                    {formatDayLong(d.day)}
                    {d.day === partialDay && <span className="live-badge">Still trading</span>}
                  </span>
                </th>
                <td>{formatPrice(d.lowAverage)}</td>
                <td>{formatPrice(d.highAverage)}</td>
                <td>{formatPrice(spread(d.lowAverage, d.highAverage))}</td>
                <td>{formatVolume(d.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {newestFirst.length > COLLAPSED_ROWS && (
        <button
          className="more"
          type="button"
          aria-expanded={expanded}
          aria-controls={tableId}
          onClick={() => {
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "Show the latest 8 days" : `Show all ${newestFirst.length} days`}
        </button>
      )}
    </section>
  );
}
