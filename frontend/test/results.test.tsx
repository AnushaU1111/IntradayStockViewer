import { screen, within } from "@testing-library/react";
import { HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { server } from "./support/server";
import { bySymbol, ok, renderApp, row, search, TSLA_ROWS } from "./support/render";

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

const table = () => within(screen.getByRole("table"));
const bodyRows = () => table().getAllByRole("row").slice(1);

describe("results", () => {
  it("shows the summary: symbol, currency, timezone, range and day count", async () => {
    server.use(bySymbol({ TSLA: () => ok(TSLA_ROWS) }).handler);
    const { user } = renderApp();
    await search(user, "TSLA");

    expect(await screen.findByRole("heading", { level: 2, name: "TSLA" })).toBeInTheDocument();
    const about = screen.getByRole("list", { name: "About these results" });
    expect(about).toHaveTextContent("Days in New York time (America/New_York)");
    expect(about).toHaveTextContent("Nov 2 – Nov 5");
    expect(about).toHaveTextContent("4 trading days");
    expect(screen.getByText("USD", { selector: ".currency" })).toBeInTheDocument();
  });

  it("omits the currency and timezone when their headers are absent", async () => {
    server.use(bySymbol({ "^GSPC": () => HttpResponse.json(TSLA_ROWS) }).handler);
    const { user } = renderApp();
    await search(user, "^gspc");
    expect(await screen.findByRole("heading", { level: 2, name: "^GSPC" })).toBeInTheDocument();
    expect(screen.queryByText("USD")).not.toBeInTheDocument();
    const about = screen.getByRole("list", { name: "About these results" });
    expect(about).not.toHaveTextContent("time");
    expect(screen.getByRole("table")).toHaveAccessibleName("^GSPC daily averages, newest first.");
  });

  it("lists every day newest first with 4-decimal prices, spread and grouped volume", async () => {
    server.use(bySymbol({ TSLA: () => ok(TSLA_ROWS) }).handler);
    const { user } = renderApp();
    await search(user, "TSLA");
    await screen.findByRole("table");

    expect(
      table()
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Day", "Avg low", "Avg high", "Spread", "Volume"]);
    const cells = bodyRows().map((r) =>
      within(r)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    );
    expect(cells[0]).toEqual(["344.5220", "350.2986", "5.7766", "218,450,835"]);
    expect(cells.at(-1)).toEqual(["406.2010", "408.9048", "2.7038", "39,849,689"]);
    expect(
      table()
        .getAllByRole("rowheader")
        .map((h) => h.textContent),
    ).toEqual(["Thu, Nov 5", "Wed, Nov 4", "Tue, Nov 3", "Mon, Nov 2"]);
    expect(screen.getByRole("table")).toHaveAccessibleName(/TSLA daily averages in USD/);
  });

  it("F1: renders Mon, Nov 2 in Honolulu and in Tokyo", async () => {
    for (const tz of ["Pacific/Honolulu", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      server.use(bySymbol({ TSLA: () => ok([row("2026-11-02", 1, 2, 3)]) }).handler);
      const { user, unmount } = renderApp();
      await search(user, "TSLA");
      expect(await screen.findByRole("rowheader", { name: "Mon, Nov 2" })).toBeInTheDocument();
      unmount();
    }
  });

  it("shows the latest 8 days, then all of them on request", async () => {
    const days = Array.from({ length: 12 }, (_, i) =>
      row(`2026-10-${String(i + 10).padStart(2, "0")}`, 1, 2, 3),
    );
    server.use(bySymbol({ TSLA: () => ok(days) }).handler);
    const { user } = renderApp();
    await search(user, "TSLA");
    await screen.findByRole("table");

    expect(bodyRows()).toHaveLength(8);
    const more = screen.getByRole("button", { name: "Show all 12 days" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(bodyRows()).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Show the latest 8 days" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("F5: the partial-day badge follows X-Partial-Day only", () => {
  const badges = () => screen.queryAllByText("Still trading");

  it("marks only the named day", async () => {
    server.use(bySymbol({ TSLA: () => ok(TSLA_ROWS, { "X-Partial-Day": "2026-11-05" }) }).handler);
    const { user } = renderApp();
    await search(user, "TSLA");
    const nov5 = await screen.findByRole("rowheader", { name: /Thu, Nov 5/ });

    expect(within(nov5).getByText("Still trading")).toBeInTheDocument();
    expect(
      within(table().getByRole("rowheader", { name: "Wed, Nov 4" })).queryByText("Still trading"),
    ).toBeNull();
    expect(screen.getByText(/Avg high · Nov 5 so far/)).toBeInTheDocument();
  });

  it("shows no badge at all without the header, even for today's date", async () => {
    server.use(bySymbol({ TSLA: () => ok(TSLA_ROWS) }).handler);
    const { user } = renderApp();
    await search(user, "TSLA");
    await screen.findByRole("table");

    expect(badges()).toHaveLength(0);
    expect(screen.getByText("Avg high · Nov 5")).toBeInTheDocument();
  });

  it("shows no badge when the header names a day not in the rows", async () => {
    server.use(bySymbol({ TSLA: () => ok(TSLA_ROWS, { "X-Partial-Day": "2026-11-06" }) }).handler);
    const { user } = renderApp();
    await search(user, "TSLA");
    await screen.findByRole("table");
    expect(badges()).toHaveLength(0);
  });
});
