import { defineConfig, devices } from "@playwright/test";

import { currentScenario, PORTS, SCENARIOS } from "./scenarios";

// One scenario per run (spec 8, R4-#1): e2e/run.mjs runs this config twice,
// with E2E_SCENARIO set to after-close and then in-session.
const scenario = currentScenario();
const { clock } = SCENARIOS[scenario];

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  grep: new RegExp(`@${scenario}\\b`),
  globalSetup: "./sessionCheck.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  outputDir: `../test-results/e2e-${scenario}`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `../playwright-report/${scenario}`, open: "never" }],
  ],
  use: {
    baseURL: `http://localhost:${PORTS.web}`,
    trace: "retain-on-failure",
    // Show the real app, not a half-finished entrance animation.
    reducedMotion: "reduce",
  },
  // F1 at full stack: the day labels must not move with the browser's timezone.
  projects: [
    { name: "honolulu", use: { ...devices["Desktop Chrome"], timezoneId: "Pacific/Honolulu" } },
    { name: "tokyo", use: { ...devices["Desktop Chrome"], timezoneId: "Asia/Tokyo" } },
  ],
  webServer: [
    {
      command: `node e2e/fakeYahoo.mjs --port ${PORTS.fakeYahoo}`,
      cwd: "..",
      url: `http://127.0.0.1:${PORTS.fakeYahoo}/__requests`,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      // Built first, so e2e exercises the compiled backend and the shared package's dist.
      command:
        "npm run build -w @isv/shared && npm run build -w @isv/backend && npm run start -w @isv/backend",
      cwd: "..",
      url: `http://127.0.0.1:${PORTS.api}/health/live`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(PORTS.api),
        LOG_LEVEL: "warn",
        YAHOO_BASE_URL: `http://127.0.0.1:${PORTS.fakeYahoo}`,
        CLOCK_FIXED_AT: clock,
      },
    },
    {
      command: `npm run build -w @isv/frontend && npm run preview -w @isv/frontend -- --port ${PORTS.web}`,
      cwd: "..",
      url: `http://localhost:${PORTS.web}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
