import { expect, test } from "@playwright/test";

import { SCENARIOS } from "./scenarios";
import { expectedRow, fakeYahooRequests, readGolden, search, tableRows } from "./support";

// Everything here runs against the built UI, the compiled API and the fake Yahoo
// server. Nothing is mocked between the browser and the API.

const DAY = 86_400;

test.describe("after the close", () => {
  const golden = readGolden("after-close");

  test("E1 @after-close: TSLA matches the after-close golden file, with no badge", async ({
    page,
  }) => {
    const response = await search(page, "TSLA");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(golden.expected);
    const headers = response.headers();
    expect(headers["x-exchange-timezone"]).toBe(golden.expectedHeaders["X-Exchange-Timezone"]);
    expect(headers["x-currency"]).toBe(golden.expectedHeaders["X-Currency"]);
    expect(headers["x-partial-day"]).toBeUndefined();

    await expect(page.getByRole("heading", { level: 2, name: "TSLA" })).toBeVisible();
    const rows = await tableRows(page);
    expect(rows.map(({ day, cells }) => ({ day, cells }))).toEqual(
      [...golden.expected].reverse().map(expectedRow),
    );
    expect(rows.every((r) => r.badge === null)).toBe(true);
    await expect(page.getByText("Still trading")).toHaveCount(0);
    const chart = page.getByTestId("chart-svg");
    await expect(
      chart.locator("text", { hasText: /^Average of 15-min lows and highs \(USD\)$/ }),
    ).toHaveCount(1);
    await expect(chart.locator("text", { hasText: /^Volume$/ })).toHaveCount(1);
  });

  test("E2 @after-close: an unknown symbol shows the not-found message", async ({ page }) => {
    const response = await search(page, "ZZZZNOTREAL1");
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toMatch(/^application\/problem\+json/);
    expect(await response.json()).toMatchObject({ status: 404, code: "SYMBOL_NOT_FOUND" });

    await expect(
      page.getByRole("heading", { name: "We couldn't find ZZZZNOTREAL1." }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("We couldn't find ZZZZNOTREAL1.");
    await expect(page.getByRole("button", { name: /retry/i })).toHaveCount(0);
  });
});

test.describe("during the session", () => {
  const golden = readGolden("in-session");
  const clockSeconds = Date.parse(SCENARIOS["in-session"].clock) / 1000;

  test("E1b @in-session: TSLA matches the in-session golden file, with the badge on Nov 5", async ({
    page,
  }) => {
    const response = await search(page, "TSLA");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(golden.expected);
    expect(response.headers()["x-partial-day"]).toBe("2026-11-05");

    const rows = await tableRows(page);
    expect(rows.map(({ day, cells }) => ({ day, cells }))).toEqual(
      [...golden.expected].reverse().map(expectedRow),
    );
    expect(rows.filter((r) => r.badge !== null).map((r) => r.day)).toEqual(["Thu, Nov 5"]);
    await expect(page.getByText("Avg high · Nov 5 so far")).toBeVisible();
  });

  test("E1c @in-session: no bar at or after the clock reaches the API", async ({ page }) => {
    await search(page, "TSLA");
    await expect(page.getByRole("table")).toBeVisible();

    const tsla = (await fakeYahooRequests()).filter((r) => r.symbol === "TSLA");
    expect(tsla.length).toBeGreaterThan(0);
    for (const r of tsla) {
      expect(r.error).toBeUndefined();
      expect(r.interval).toBe("15m");
      expect(r.period2).toBe(clockSeconds);
      expect(r.period1).toBe(clockSeconds - 35 * DAY);
      expect(r.bars).toBeGreaterThan(0);
      expect(r.lastBar).toBeLessThan(clockSeconds);
    }
  });
});
