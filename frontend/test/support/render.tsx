import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";

import type { DailySummary } from "@isv/shared";

import { createQueryClient } from "../../src/api/queryClient";
import { App } from "../../src/App";

export const SUMMARY_URL = "/api/v1/stocks/:symbol/daily-summary";

export function renderApp(options: Parameters<typeof userEvent.setup>[0] = {}) {
  const user = userEvent.setup(options);
  const client = createQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return { ...view, user, client };
}

/** Types a symbol into the real form and submits it with Enter. */
export async function search(user: ReturnType<typeof userEvent.setup>, symbol: string) {
  const input = screen.getByRole("textbox", { name: "Stock symbol" });
  await user.clear(input);
  await user.type(input, `${symbol}{Enter}`);
}

export const row = (day: string, low: number, high: number, volume: number): DailySummary => ({
  day,
  lowAverage: low,
  highAverage: high,
  volume,
});

export const TSLA_ROWS = [
  row("2026-11-02", 406.201, 408.9048, 39849689),
  row("2026-11-03", 398.4825, 400.1821, 32274494),
  row("2026-11-04", 385.5077, 388.5708, 58867385),
  row("2026-11-05", 344.522, 350.2986, 218450835),
];

export const AAPL_ROWS = [
  row("2026-11-03", 268.11, 270.5, 41000000),
  row("2026-11-04", 266.9, 269.0042, 39500000),
];

export function ok(rows: DailySummary[], headers: Record<string, string> = {}) {
  return HttpResponse.json(rows, {
    headers: { "X-Exchange-Timezone": "America/New_York", "X-Currency": "USD", ...headers },
  });
}

export function problem(
  status: number,
  code: string,
  headers: Record<string, string> = {},
  extra: object = {},
) {
  return HttpResponse.json(
    {
      type: "about:blank",
      title: "Error",
      status,
      detail: "Something",
      code,
      requestId: "req-1",
      ...extra,
    },
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

/** A handler per symbol, recording every request it receives. */
export function bySymbol(
  responders: Record<string, (request: Request) => Response | Promise<Response>>,
) {
  const requests: { symbol: string; request: Request }[] = [];
  const handler = http.get(SUMMARY_URL, ({ params, request }) => {
    const symbol = String(params.symbol);
    requests.push({ symbol, request });
    const respond = responders[symbol];
    if (!respond) throw new Error(`No responder for ${symbol}`);
    return respond(request);
  });
  return {
    handler,
    requests,
    count: (symbol: string) => requests.filter((r) => r.symbol === symbol).length,
  };
}

export async function never(): Promise<Response> {
  await delay("infinite");
  return HttpResponse.json([]);
}
