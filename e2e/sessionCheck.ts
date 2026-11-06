import { readFileSync } from "node:fs";

import { currentScenario, SCENARIOS } from "./scenarios";

interface Period {
  start: number;
  end: number;
}

/**
 * Global setup: the two clocks only test what they claim to if the fixture's
 * regular session puts 18:00 UTC inside it and 21:30 UTC after it (plan,
 * Phase 7). The capture is checked as it is; it is never edited to fit.
 */
export default function sessionCheck(): void {
  const scenario = currentScenario();
  const { clock, session } = SCENARIOS[scenario];
  const fixture = JSON.parse(
    readFileSync(new URL("../backend/test/fixtures/yahoo/TSLA.json", import.meta.url), "utf8"),
  ) as {
    response: {
      body: { chart: { result: [{ meta: { currentTradingPeriod: { regular: Period } } }] } };
    };
  };
  const { start, end } = fixture.response.body.chart.result[0].meta.currentTradingPeriod.regular;
  const t = Date.parse(clock) / 1000;
  const actual = t < start ? "before" : t < end ? "inside" : "after";
  if (actual !== session) {
    const iso = (s: number) => new Date(s * 1000).toISOString();
    throw new Error(
      `Scenario ${scenario}: the clock ${clock} is ${actual} the fixture's regular session ` +
        `(${iso(start)} to ${iso(end)}), but this scenario needs it ${session}. ` +
        "Derive a labeled synthetic fixture instead of editing the capture (DECISIONS D-45).",
    );
  }
}
