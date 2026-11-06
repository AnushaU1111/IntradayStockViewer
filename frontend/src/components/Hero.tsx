import type { ReactNode } from "react";

import "./Hero.css";

/** The landing area: headline, the search form and the decorative backdrop. */
export function Hero({ children, backdrop }: { children: ReactNode; backdrop?: ReactNode }) {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      {backdrop}
      <div className="hero-horizon" aria-hidden="true" />
      <p className="eyebrow rise d1">15-minute bars · last month · grouped by day</p>
      <h1 className="rise d2" id="hero-title">
        Bring the month <span className="lit">into the light.</span>
      </h1>
      <p className="hero-sub rise d3">
        Enter a symbol to see the average low, the average high and the total volume for each
        trading day.
      </p>
      <div className="hero-form rise d4">{children}</div>
    </section>
  );
}
