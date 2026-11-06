import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "./support/server";
import {
  AAPL_ROWS,
  bySymbol,
  never,
  ok,
  problem,
  renderApp,
  search,
  TSLA_ROWS,
} from "./support/render";

const RAW = "RAW-SERVER-TEXT";
const results = () => within(screen.getByRole("region", { name: "Results" }));
const live = () => screen.getByRole("status");

describe("F3: error states, one message per code", () => {
  it.each([
    [404, "SYMBOL_NOT_FOUND", {}, "We couldn't find ZZZZ."],
    [422, "INTRADAY_UNAVAILABLE", {}, "No 15-minute data for ZZZZ."],
    [
      422,
      "UNSUPPORTED_INSTRUMENT",
      { instrumentType: "MUTUALFUND" },
      "ZZZZ is a mutual fund; only stocks, ETFs and indices are supported.",
    ],
    [
      422,
      "UNSUPPORTED_INSTRUMENT",
      { instrumentType: "ETF_LIKE_THING" },
      "ZZZZ is an etf like thing; only stocks, ETFs and indices are supported.",
    ],
    [422, "UNSUPPORTED_INSTRUMENT", {}, "ZZZZ isn't a stock, ETF or index, so it isn't supported."],
  ])("%i %s: shows the message with no Retry", async (status, code, extra, message) => {
    const api = bySymbol({ ZZZZ: () => problem(status, code, {}, { detail: RAW, ...extra }) });
    server.use(api.handler);
    const { user } = renderApp();

    await search(user, "ZZZZ");
    expect(await results().findByRole("heading", { name: message })).toBeInTheDocument();
    expect(results().queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(RAW))).not.toBeInTheDocument();
    expect(api.count("ZZZZ")).toBe(1);
  });

  it("400 INVALID_SYMBOL: inline field error, focus back on the input", async () => {
    server.use(
      bySymbol({ ZZZZ: () => problem(400, "INVALID_SYMBOL", {}, { detail: RAW }) }).handler,
    );
    const { user } = renderApp();
    const input = screen.getByRole("textbox", { name: "Stock symbol" });

    await search(user, "ZZZZ");
    expect(
      await screen.findByText("That isn't a valid symbol.", { selector: ".field-error" }),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    expect(results().queryByRole("heading")).not.toBeInTheDocument();
  });

  it.each([
    [502, "UPSTREAM_BAD_RESPONSE"],
    [504, "UPSTREAM_TIMEOUT"],
  ])(
    "%i %s: unavailable message, Retry enabled at once and never automatic",
    async (status, code) => {
      const api = bySymbol({ TSLA: () => problem(status, code, {}, { detail: RAW }) });
      server.use(api.handler);
      const { user } = renderApp();

      await search(user, "TSLA");
      expect(
        await results().findByRole("heading", { name: "Market data is temporarily unavailable." }),
      ).toBeInTheDocument();
      const retry = results().getByRole("button", { name: "Retry" });
      expect(retry).toBeEnabled();
      expect(api.count("TSLA")).toBe(1);

      await user.click(retry);
      await waitFor(() => {
        expect(api.count("TSLA")).toBe(2);
      });
    },
  );

  it("a 200 with no rows is the empty state", async () => {
    server.use(bySymbol({ TSLA: () => ok([]) }).handler);
    const { user } = renderApp();
    await search(user, "TSLA");
    expect(
      await results().findByRole("heading", {
        name: "No intraday data for TSLA in the last month.",
      }),
    ).toBeInTheDocument();
  });

  it("the skeleton marks the results busy while loading", async () => {
    server.use(bySymbol({ TSLA: never }).handler);
    const { user } = renderApp();
    await search(user, "TSLA");
    expect(screen.getByRole("region", { name: "Results" })).toHaveAttribute("aria-busy", "true");
    expect(live()).toHaveTextContent("Loading TSLA.");
  });
});

describe("F3: countdown after 429 and 503", () => {
  beforeEach(() => {
    // Only the clock and the countdown's interval are faked. MSW, user-event and
    // TanStack Query keep real timeouts.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const tick = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  it.each([
    [429, "RATE_LIMITED", "3", "You're searching too quickly.", 3],
    [503, "UPSTREAM_RATE_LIMITED", "12", "Market data is temporarily unavailable.", 12],
    [503, "UPSTREAM_BLOCKED", "4", "Market data is temporarily unavailable.", 4],
    [503, "SERVER_BUSY", "2", "The server is busy.", 2],
    [429, "RATE_LIMITED", null, "You're searching too quickly.", 5],
    [503, "UPSTREAM_RATE_LIMITED", "soon", "Market data is temporarily unavailable.", 5],
  ])("%i %s with Retry-After %s", async (status, code, retryAfter, title, seconds) => {
    const headers: Record<string, string> =
      retryAfter === null ? {} : { "Retry-After": retryAfter };
    const api = bySymbol({ TSLA: () => problem(status, code, headers, { detail: RAW }) });
    server.use(api.handler);
    const { user } = renderApp({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await search(user, "TSLA");
    expect(await results().findByRole("heading", { name: title })).toBeInTheDocument();
    const retry = results().getByRole("button", { name: `Retry in ${seconds} s` });
    expect(retry).toBeDisabled();
    expect(live()).toHaveTextContent(`${title} Try again in ${seconds} seconds.`);

    tick((seconds - 1) * 1000);
    expect(results().getByRole("button", { name: "Retry in 1 s" })).toBeDisabled();
    tick(1000);
    expect(results().getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(api.count("TSLA")).toBe(1); // never automatic

    await user.click(results().getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(api.count("TSLA")).toBe(2);
    });
  });

  it("F8: another symbol goes out at once; the held one waits for its countdown [R4-#3]", async () => {
    const api = bySymbol({
      TSLA: () => problem(503, "UPSTREAM_RATE_LIMITED", { "Retry-After": "30" }),
      AAPL: () => ok(AAPL_ROWS),
    });
    server.use(api.handler);
    const { user } = renderApp({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await search(user, "TSLA");
    await results().findByRole("button", { name: "Retry in 30 s" });

    await search(user, "AAPL");
    expect(await results().findByText("2 trading days")).toBeInTheDocument();
    expect(api.count("AAPL")).toBe(1);

    tick(10_000);
    await search(user, "TSLA");
    expect(await results().findByRole("button", { name: "Retry in 20 s" })).toBeDisabled();
    expect(api.count("TSLA")).toBe(1);

    tick(20_000);
    expect(api.count("TSLA")).toBe(1);
    await user.click(results().getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(api.count("TSLA")).toBe(2);
    });
  });
});

describe("F4: timeout vs network vs bad response [R5-#6]", () => {
  it("client timeout: can't reach the server, no auto-retry", async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(40));
    const api = bySymbol({ TSLA: never });
    server.use(api.handler);
    const { user } = renderApp();

    await search(user, "TSLA");
    expect(
      await results().findByRole("heading", { name: "Can't reach the server." }),
    ).toBeInTheDocument();
    expect(results().getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(api.count("TSLA")).toBe(1);
  });

  it("network failure: retried exactly once, then can't reach the server", async () => {
    const api = bySymbol({ TSLA: () => HttpResponse.error() });
    server.use(api.handler);
    const { user } = renderApp();

    await search(user, "TSLA");
    expect(
      await results().findByRole("heading", { name: "Can't reach the server." }),
    ).toBeInTheDocument();
    expect(api.count("TSLA")).toBe(2);
  });

  it("network failure then success: the one retry recovers", async () => {
    let calls = 0;
    const api = bySymbol({ TSLA: () => (++calls === 1 ? HttpResponse.error() : ok(TSLA_ROWS)) });
    server.use(api.handler);
    const { user } = renderApp();

    await search(user, "TSLA");
    expect(await results().findByText("4 trading days")).toBeInTheDocument();
    expect(api.count("TSLA")).toBe(2);
  });

  it("200 with an unparseable body: upstream-failure message, no auto-retry", async () => {
    const api = bySymbol({
      TSLA: () =>
        new HttpResponse("{not json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    server.use(api.handler);
    const { user } = renderApp();

    await search(user, "TSLA");
    expect(
      await results().findByRole("heading", { name: "Market data is temporarily unavailable." }),
    ).toBeInTheDocument();
    expect(api.count("TSLA")).toBe(1);
  });
});
