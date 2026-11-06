import { useId } from "react";
import type { RefObject, SubmitEvent } from "react";

import { SYMBOL_MAX_LENGTH } from "@isv/shared";

import "./SymbolForm.css";

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  error: string | null;
  onSubmit: (raw: string) => void;
}

/**
 * The search form. It stays enabled while a request is in flight, so a new
 * search can cancel and replace the current one (DECISIONS D-40, R4-#5).
 */
export function SymbolForm({ inputRef, error, onSubmit }: Props) {
  const errorId = useId();
  const hintId = useId();

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(inputRef.current?.value ?? "");
  }

  return (
    <form className="search-form" role="search" noValidate onSubmit={handleSubmit}>
      <div className="search" data-invalid={error !== null}>
        <svg
          className="search-icon"
          width="18"
          height="18"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <label className="sr-only" htmlFor="symbol">
          Stock symbol
        </label>
        <input
          ref={inputRef}
          id="symbol"
          name="symbol"
          type="text"
          placeholder="Symbol, for example TSLA"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={SYMBOL_MAX_LENGTH * 2}
          aria-invalid={error !== null}
          aria-describedby={error === null ? hintId : `${errorId} ${hintId}`}
        />
        <button className="go" type="submit">
          Look up
        </button>
      </div>
      {error !== null && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
      <p className="search-hint" id={hintId}>
        Stocks, ETFs and indexes. Prices in the exchange&apos;s currency.
      </p>
    </form>
  );
}
