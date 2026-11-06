import type { ReactNode } from "react";

import "./Hero.css";

/** The landing area: headline, the search form and the decorative backdrop. */
export function Hero({
  children,
  backdrop,
  showCue,
}: {
  children: ReactNode;
  backdrop?: ReactNode;
  showCue?: boolean;
}) {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      {backdrop}
      <div className="hero-horizon" aria-hidden="true" />
      <p className="eyebrow rise d1">15-minute bars · past month</p>
      <h1 className="rise d2" id="hero-title">
        Intraday highs and lows, <span className="lit">averaged by day.</span>
      </h1>
      <p className="hero-sub rise d3">
        Search a stock, ETF or index. Each trading day of the past month becomes one row: average
        low, average high and total volume.
      </p>
      <div className="hero-form rise d4">{children}</div>
      {showCue === true && <div className="scroll-cue" aria-hidden="true" />}
    </section>
  );
}
