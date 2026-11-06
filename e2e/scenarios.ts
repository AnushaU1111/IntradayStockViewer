/**
 * The two clocks the real-stack tests run under (spec 8, DECISIONS D-37). A
 * backend has one clock, so each scenario is its own Playwright run with its
 * own servers and its own golden file.
 */
export const SCENARIOS = {
  "after-close": {
    clock: "2026-11-05T21:30:00Z",
    golden: "golden.after-close.json",
    /** Where the clock must sit relative to the fixture's regular session. */
    session: "after",
  },
  "in-session": {
    clock: "2026-11-05T18:00:00Z",
    golden: "golden.in-session.json",
    session: "inside",
  },
} as const;

export type ScenarioName = keyof typeof SCENARIOS;

export const PORTS = { fakeYahoo: 4010, api: 3001, web: 4173 } as const;

export function currentScenario(): ScenarioName {
  const name = process.env.E2E_SCENARIO ?? "after-close";
  if (!(name in SCENARIOS)) {
    throw new Error(
      `Unknown E2E_SCENARIO "${name}". Use one of: ${Object.keys(SCENARIOS).join(", ")}`,
    );
  }
  return name as ScenarioName;
}
