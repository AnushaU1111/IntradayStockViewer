import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import type { DailySummary } from "../packages/shared/src/dto";

import { PORTS, SCENARIOS } from "./scenarios";
import type { ScenarioName } from "./scenarios";

export interface Golden {
  scenario: ScenarioName;
  clock: string;
  expectedHeaders: Record<string, string | null>;
  expected: DailySummary[];
}

/** Expected values always come from the Python oracle's files, never typed into a test. */
export function readGolden(scenario: ScenarioName): Golden {
  const file = new URL(
    `../backend/test/fixtures/golden/${SCENARIOS[scenario].golden}`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(file, "utf8")) as Golden;
}

export interface FakeYahooRequest {
  symbol: string;
  period1: number;
  period2: number;
  interval: string | null;
  bars?: number;
  lastBar?: number | null;
  error?: string;
}

export async function fakeYahooRequests(): Promise<FakeYahooRequest[]> {
  const res = await fetch(`http://127.0.0.1:${PORTS.fakeYahoo}/__requests`);
  return (await res.json()) as FakeYahooRequest[];
}

/** Searches through the real form, returning the API response the page received. */
export async function search(page: Page, symbol: string) {
  await page.goto("/");
  const response = page.waitForResponse(
    (r) => r.url().includes("/api/v1/stocks/") && r.request().method() === "GET",
  );
  const input = page.getByRole("textbox", { name: "Stock symbol" });
  await input.fill(symbol);
  await input.press("Enter");
  return response;
}

/**
 * The table text the UI should show for one golden row. The test side may use
 * Date in UTC as an independent oracle; the app itself never builds a Date.
 */
export function expectedRow(d: DailySummary) {
  const [y, m, day] = d.day.split("-").map(Number) as [number, number, number];
  const label = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const price = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const spread = (Math.round(d.highAverage * 10_000) - Math.round(d.lowAverage * 10_000)) / 10_000;
  return {
    day: label,
    cells: [
      price(d.lowAverage),
      price(d.highAverage),
      price(spread),
      d.volume.toLocaleString("en-US"),
    ],
  };
}

/** Every row of the results table as text, after expanding it. */
export async function tableRows(page: Page) {
  const more = page.getByRole("button", { name: /^Show all \d+ days$/ });
  if (await more.isVisible()) await more.click();
  const rows = await page.getByRole("table").locator("tbody tr").all();
  return Promise.all(
    rows.map(async (row) => {
      const badge = row.locator("th .live-badge");
      const badgeText = (await badge.count()) > 0 ? await badge.innerText() : null;
      const header = await row.locator("th").innerText();
      return {
        day: (badgeText === null ? header : header.replace(badgeText, "")).trim(),
        badge: badgeText,
        cells: (await row.locator("td").allInnerTexts()).map((t) => t.trim()),
      };
    }),
  );
}
