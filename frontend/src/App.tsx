import { useCallback, useEffect, useRef, useState } from "react";

import { parseSymbol } from "@isv/shared";

import type { DailySummaryResult } from "./api/client";
import { useDailySummary } from "./api/useDailySummary";
import { Hero } from "./components/Hero";
import { LiveRegion } from "./components/LiveRegion";
import { ResultsHeader } from "./components/ResultsHeader";
import { ResultsTable } from "./components/ResultsTable";
import { Nav } from "./components/Nav";
import { EmptyPanel, ErrorPanel, LoadingSkeleton } from "./components/StatusPanel";
import { SymbolForm } from "./components/SymbolForm";
import { useHolds } from "./hooks/useHolds";
import { describeError, errorAnnouncement, holdSeconds } from "./lib/describeError";
import type { ErrorView } from "./lib/describeError";
import { rejectionMessage } from "./lib/messages";

interface Search {
  symbol: string;
  /** Set when the symbol was searched during its own countdown: no request until Retry. */
  blocked: boolean;
}

/** Exactly one of these is on screen at a time (spec 5.3). */
type View =
  | { kind: "idle" }
  | { kind: "loading"; symbol: string }
  | { kind: "success"; result: DailySummaryResult }
  | { kind: "empty"; symbol: string }
  | { kind: "error"; symbol: string; error: ErrorView };

export function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState<Search | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const holds = useHolds();
  const { hold } = holds;

  const onFailure = useCallback(
    (symbol: string, error: unknown) => {
      const seconds = holdSeconds(error);
      if (seconds !== null) hold(symbol, seconds, error);
    },
    [hold],
  );
  const query = useDailySummary(search?.symbol ?? null, {
    enabled: search !== null && !search.blocked,
    onFailure,
  });

  const view = deriveView();
  function deriveView(): View {
    if (search === null) return { kind: "idle" };
    const { symbol } = search;
    if (query.data) {
      return query.data.days.length > 0
        ? { kind: "success", result: query.data }
        : { kind: "empty", symbol };
    }
    if (query.error) return { kind: "error", symbol, error: describeError(query.error, symbol) };
    const held = holds.errorFor(symbol);
    if (search.blocked && held !== undefined)
      return { kind: "error", symbol, error: describeError(held, symbol) };
    return { kind: "loading", symbol };
  }

  // A 400 from the API is shown like a client-side rejection: next to the input.
  const serverFieldError = view.kind === "error" && view.error.field ? view.error.title : null;
  const fieldError = clientError ?? serverFieldError;
  useEffect(() => {
    if (serverFieldError !== null) inputRef.current?.focus();
  }, [serverFieldError, query.errorUpdatedAt]);

  function submit(raw: string) {
    const parsed = parseSymbol(raw);
    if (!parsed.ok) {
      setClientError(rejectionMessage(parsed.reason));
      inputRef.current?.focus();
      return;
    }
    setClientError(null);
    const { symbol } = parsed;
    const blocked = holds.isHeld(symbol);
    if (search?.symbol === symbol) {
      if (search.blocked && !blocked) setSearch({ symbol, blocked: false });
      else if (!search.blocked && !blocked && query.isError) void query.refetch();
    } else {
      setSearch({ symbol, blocked });
    }
    resultsRef.current?.scrollIntoView({ block: "start" });
  }

  function retry() {
    if (search === null || holds.isHeld(search.symbol)) return;
    // Unblocking enables the query, and an errored query is stale, so it fetches.
    if (search.blocked) setSearch({ symbol: search.symbol, blocked: false });
    else void query.refetch();
  }

  return (
    <>
      <a className="skip-link" href="#results">
        Skip to results
      </a>
      <Nav solid={false} />
      <main>
        <Hero>
          <SymbolForm inputRef={inputRef} error={fieldError} onSubmit={submit} />
        </Hero>
        <section
          className="results"
          id="results"
          ref={resultsRef}
          aria-label="Results"
          aria-busy={view.kind === "loading"}
        >
          {view.kind === "loading" && <LoadingSkeleton />}
          {view.kind === "empty" && <EmptyPanel symbol={view.symbol} />}
          {view.kind === "error" && !view.error.field && (
            <ErrorPanel
              view={view.error}
              remaining={holds.remaining(view.symbol)}
              onRetry={retry}
            />
          )}
          {view.kind === "success" && (
            <>
              <ResultsHeader result={view.result} />
              <ResultsTable
                symbol={view.result.symbol}
                days={view.result.days}
                currency={view.result.currency}
                partialDay={view.result.partialDay}
              />
            </>
          )}
        </section>
      </main>
      <LiveRegion message={announce(view, fieldError)} />
    </>
  );
}

function announce(view: View, fieldError: string | null): string {
  if (fieldError !== null) return fieldError;
  switch (view.kind) {
    case "idle":
      return "";
    case "loading":
      return `Loading ${view.symbol}.`;
    case "empty":
      return `No intraday data for ${view.symbol} in the last month.`;
    case "error":
      return errorAnnouncement(view.error);
    case "success":
      return `${view.result.symbol}: ${view.result.days.length} trading days loaded.`;
  }
}
