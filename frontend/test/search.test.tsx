import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { server } from "./support/server";
import { AAPL_ROWS, bySymbol, never, ok, renderApp, search, TSLA_ROWS } from "./support/render";

describe("search form", () => {
  it("F2: a new search while loading cancels and replaces the first [R4-#5]", async () => {
    const api = bySymbol({ TSLA: never, AAPL: () => ok(AAPL_ROWS) });
    server.use(api.handler);
    const { user } = renderApp();

    await search(user, "tsla");
    await waitFor(() => {
      expect(api.count("TSLA")).toBe(1);
    });
    const submit = screen.getByRole("button", { name: "Look up" });
    expect(submit).toBeEnabled();

    await search(user, "aapl");
    await screen.findByText("2 trading days");

    const first = api.requests.find((r) => r.symbol === "TSLA");
    expect(first?.request.signal.aborted).toBe(true);
    expect(api.count("TSLA")).toBe(1);
    expect(api.count("AAPL")).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("F7: typing and pressing Enter sends the request and announces it", async () => {
    const api = bySymbol({ TSLA: () => ok(TSLA_ROWS) });
    server.use(api.handler);
    const { user } = renderApp();
    const live = screen.getByRole("status");

    await search(user, "TSLA");
    expect(live).toHaveAttribute("aria-live", "polite");
    await waitFor(() => {
      expect(live).toHaveTextContent("TSLA: 4 trading days loaded.");
    });
    expect(api.count("TSLA")).toBe(1);
  });

  it("validates with the shared rule before any request, and refocuses the input", async () => {
    const api = bySymbol({});
    server.use(api.handler);
    const { user } = renderApp();
    const input = screen.getByRole("textbox", { name: "Stock symbol" });

    await search(user, "TS LA");
    expect(
      screen.getByText(/Use letters, digits/, { selector: ".field-error" }),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      expect.stringContaining("Use letters, digits") as string,
    );
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.keyboard("{Enter}");
    expect(screen.getByText(/Enter a symbol/, { selector: ".field-error" })).toBeInTheDocument();
    expect(api.requests).toHaveLength(0);
  });

  it("re-submitting the same symbol does not send a second request", async () => {
    const api = bySymbol({ TSLA: () => ok(TSLA_ROWS) });
    server.use(api.handler);
    const { user } = renderApp();

    await search(user, "TSLA");
    await screen.findByText("4 trading days");
    await search(user, "tsla");
    expect(api.count("TSLA")).toBe(1);
  });
});
