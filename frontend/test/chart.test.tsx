import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { DailySummary } from "@isv/shared";

import { ResultsChart } from "../src/components/ResultsChart";
import { priceScale } from "../src/lib/scale";

import { server } from "./support/server";
import { bySymbol, ok, renderApp, search, TSLA_ROWS } from "./support/render";

function Harness({
  currency = "USD",
  partialDay = null,
  days = TSLA_ROWS,
}: {
  currency?: string | null;
  partialDay?: string | null;
  days?: DailySummary[];
}) {
  const [focus, setFocus] = useState(days.length - 1);
  return (
    <ResultsChart
      symbol="TSLA"
      days={days}
      currency={currency}
      partialDay={partialDay}
      focusIndex={focus}
      onFocusIndex={setFocus}
    />
  );
}

const svg = () => screen.getByTestId("chart-svg");

describe("F9: chart labels [R4-#6]", () => {
  it("names the price axis with the currency and the volume axis Volume", () => {
    render(<Harness currency="USD" />);
    const text = svg().textContent;
    expect(text).toContain("Average of 15-min lows and highs (USD)");
    expect(within(svg()).getByText("Volume")).toBeInTheDocument();
    expect(text).not.toMatch(/Low \/ High|Shares/);
  });

  it("drops the unit when X-Currency is absent", () => {
    render(<Harness currency={null} />);
    expect(within(svg()).getByText("Average of 15-min lows and highs")).toBeInTheDocument();
    expect(svg().textContent).not.toContain("(");
  });

  it("shows the volume axis in compact units", () => {
    render(<Harness />);
    expect(within(svg()).getByText("218.5M")).toBeInTheDocument();
  });

  it("describes itself to assistive technology, including both axis titles", () => {
    render(<Harness />);
    const chart = screen.getByRole("group", { name: /TSLA: average daily range and volume/ });
    expect(chart).toHaveAccessibleDescription(
      expect.stringContaining(
        "Price axis: Average of 15-min lows and highs (USD). Volume axis: Volume.",
      ) as string,
    );
    expect(chart).toHaveAccessibleDescription(
      expect.stringContaining("Highest average high 408.9048 USD on Nov 2") as string,
    );
  });
});

describe("chart marks", () => {
  it("draws one low-to-high bar per day", () => {
    const { container } = render(<Harness />);
    const bars = container.querySelectorAll("rect.rbar");
    expect([...bars].map((b) => b.getAttribute("data-day"))).toEqual(TSLA_ROWS.map((d) => d.day));
    for (const bar of bars) expect(Number(bar.getAttribute("height"))).toBeGreaterThanOrEqual(3);
  });

  it("F5: marks the X-Partial-Day bar, and nothing without the header", () => {
    const { container, unmount } = render(<Harness partialDay="2026-11-05" />);
    expect(within(svg()).getByText("Still trading")).toBeInTheDocument();
    expect(container.querySelector('rect.rbar[data-day="2026-11-05"]')).toHaveAttribute(
      "fill",
      "var(--live)",
    );
    expect(container.querySelector('rect.rbar[data-day="2026-11-04"]')).not.toHaveAttribute(
      "fill",
      "var(--live)",
    );
    unmount();

    render(<Harness partialDay={null} />);
    expect(within(svg()).queryByText("Still trading")).not.toBeInTheDocument();
    expect(screen.queryByText("Still trading")).not.toBeInTheDocument();
  });
});

describe("chart keyboard use", () => {
  it("arrow keys move between days and announce them; Tab leaves the chart", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button type="button">after</button>
      </>,
    );
    const chart = screen.getByRole("group", { name: /average daily range/ });
    chart.focus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Wed, Nov 4", { selector: ".legend-day" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Wed, Nov 4: average low 385\.5077, average high 388\.5708, volume 58,867,385\./,
      ),
    ).toBeInTheDocument();

    await user.keyboard("{Home}");
    expect(screen.getByText("Mon, Nov 2", { selector: ".legend-day" })).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Mon, Nov 2", { selector: ".legend-day" })).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(screen.getByText("Thu, Nov 5", { selector: ".legend-day" })).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  it("keeps the table's highlighted row on the chart's day", async () => {
    server.use(bySymbol({ TSLA: () => ok(TSLA_ROWS) }).handler);
    const { user } = renderApp();
    await search(user, "TSLA");
    const chart = await screen.findByRole("group", { name: /average daily range/ });
    const focused = () =>
      screen.getAllByRole("row").filter((r) => r.getAttribute("data-focus") === "true");

    expect(focused().map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "Thu, Nov 5",
    ]);
    chart.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(focused().map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "Tue, Nov 3",
    ]);
  });
});

describe("priceScale", () => {
  it("covers the data with nice steps and a little headroom", () => {
    const s = priceScale(344.522, 408.9048);
    expect(s.step).toBe(20);
    expect(s.min).toBeLessThan(344.522);
    expect(s.max).toBeGreaterThan(408.9048);
    expect(s.ticks[0]).toBe(s.min);
    expect(s.ticks.at(-1)).toBe(s.max);
  });

  it("handles a flat series and tiny prices", () => {
    const flat = priceScale(10, 10);
    expect(flat.max).toBeGreaterThan(flat.min);
    const tiny = priceScale(0.0012, 0.0019);
    expect(tiny.decimals).toBe(4);
  });
});
