import { useRef, useState } from "react";

import { parseSymbol } from "@isv/shared";

import { useDailySummary } from "./api/useDailySummary";
import { Hero } from "./components/Hero";
import { LiveRegion } from "./components/LiveRegion";
import { Nav } from "./components/Nav";
import { SymbolForm } from "./components/SymbolForm";
import { rejectionMessage } from "./lib/messages";

export function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const query = useDailySummary(symbol, { enabled: true });

  function submit(raw: string) {
    const parsed = parseSymbol(raw);
    if (!parsed.ok) {
      setFieldError(rejectionMessage(parsed.reason));
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    setSymbol(parsed.symbol);
    resultsRef.current?.scrollIntoView({ block: "start" });
  }

  let announcement = "";
  if (fieldError !== null) announcement = fieldError;
  else if (symbol !== null && query.isFetching) announcement = `Loading ${symbol}.`;
  else if (symbol !== null && query.data)
    announcement = `${symbol}: ${query.data.days.length} trading days loaded.`;

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
        <section id="results" ref={resultsRef} aria-label="Results" aria-busy={query.isFetching}>
          {symbol !== null && query.data && <p>{query.data.days.length} trading days</p>}
        </section>
      </main>
      <LiveRegion message={announcement} />
    </>
  );
}
