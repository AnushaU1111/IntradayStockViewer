import type { ErrorView } from "../lib/describeError";

import "./StatusPanel.css";

interface ErrorProps {
  view: ErrorView;
  remaining: number;
  onRetry: () => void;
}

export function ErrorPanel({ view, remaining, onRetry }: ErrorProps) {
  const counting = view.retry === "countdown" && remaining > 0;
  return (
    <div className="panel" data-tone="error">
      <h2>{view.title}</h2>
      {view.detail !== null && <p>{view.detail}</p>}
      {counting && (
        <p className="countdown">
          <span className="countdown-ring" aria-hidden="true" />
          <span>
            Try again in <span className="num">{remaining}</span> s
          </span>
        </p>
      )}
      {view.retry !== "none" && (
        <button className="retry" type="button" disabled={counting} onClick={onRetry}>
          {counting ? `Retry in ${remaining} s` : "Retry"}
        </button>
      )}
    </div>
  );
}

export function EmptyPanel({ symbol }: { symbol: string }) {
  return (
    <div className="panel">
      <h2>No intraday data for {symbol} in the last month.</h2>
      <p>The market may have been closed, or the symbol may not trade on a regular session.</p>
    </div>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      <div className="skeleton-block sk-head" />
      <div className="skeleton-block sk-chart" />
      <div className="skeleton-block sk-table" />
    </div>
  );
}
