// A stand-in for Yahoo's chart endpoint, for the real-stack e2e runs.
//
// It serves the captured fixtures by symbol, cut by sliceFixture to the window
// the API asked for (period1 <= t < period2). That is the same helper the A11
// golden test uses, so the in-session run sees exactly the bars Yahoo would
// have returned at 18:00 UTC. Every request is recorded and can be read back
// from GET /__requests (test E1c).
//
// Node 24 strips the types from sliceFixture.ts when it imports it.
import { readFileSync } from "node:fs";
import http from "node:http";
import { parseArgs } from "node:util";

import { sliceFixture } from "../backend/test/support/sliceFixture.ts";

const { values } = parseArgs({ options: { port: { type: "string", default: "4010" } } });
const port = Number(values.port);

const FIXTURE_BY_SYMBOL = { TSLA: "TSLA", "^GSPC": "GSPC", "BTC-USD": "BTC-USD", VFIAX: "VFIAX" };
const load = (name) =>
  JSON.parse(
    readFileSync(new URL(`../backend/test/fixtures/yahoo/${name}.json`, import.meta.url), "utf8"),
  );
const fixtures = Object.fromEntries(
  [...Object.values(FIXTURE_BY_SYMBOL), "unknown-symbol"].map((name) => [name, load(name)]),
);

/** Timestamps and every quote array of a sliced body, for the self-checks. */
function seriesOf(body) {
  const result = body?.chart?.result?.[0];
  return { timestamps: result?.timestamp ?? [], quote: result?.indicators?.quote?.[0] ?? {} };
}

/** Fails loudly if a slice ever misaligns arrays or leaks a bar outside the window. */
function checkSlice(body, period1, period2) {
  const { timestamps, quote } = seriesOf(body);
  for (const [field, series] of Object.entries(quote)) {
    if (series.length !== timestamps.length) {
      throw new Error(
        `sliced ${field} has ${series.length} values for ${timestamps.length} timestamps`,
      );
    }
  }
  const outside = timestamps.find((t) => t < period1 || t >= period2);
  if (outside !== undefined)
    throw new Error(`bar at ${outside} is outside [${period1}, ${period2})`);
  return timestamps;
}

// Self-check at startup: each fixture sliced to its own capture window keeps
// its arrays aligned, and a window ending mid-fixture really drops later bars.
for (const [name, fixture] of Object.entries(fixtures)) {
  const { period1, period2 } = fixture.capture.request.query;
  checkSlice(
    sliceFixture(fixture, Number(period1), Number(period2)).response.body,
    Number(period1),
    Number(period2),
  );
  const all = seriesOf(fixture.response.body).timestamps;
  if (all.length > 1) {
    const cut = all[Math.floor(all.length / 2)];
    const kept = checkSlice(sliceFixture(fixture, 0, cut).response.body, 0, cut);
    if (kept.length !== all.filter((t) => t < cut).length)
      throw new Error(`${name}: slice at ${cut} kept the wrong bars`);
  }
}

const requests = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (req.method === "GET" && url.pathname === "/__requests") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(requests));
    return;
  }

  const match = /^\/v8\/finance\/chart\/([^/]+)$/.exec(url.pathname);
  if (req.method !== "GET" || !match) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "fake Yahoo serves GET /v8/finance/chart/:symbol only" }));
    return;
  }

  const symbol = decodeURIComponent(match[1]);
  const period1 = Number(url.searchParams.get("period1"));
  const period2 = Number(url.searchParams.get("period2"));
  try {
    const fixture = fixtures[FIXTURE_BY_SYMBOL[symbol] ?? "unknown-symbol"];
    const { response } = sliceFixture(fixture, period1, period2);
    const timestamps = checkSlice(response.body, period1, period2);
    requests.push({
      symbol,
      period1,
      period2,
      interval: url.searchParams.get("interval"),
      bars: timestamps.length,
      lastBar: timestamps.at(-1) ?? null,
    });
    res.writeHead(response.status, response.headers);
    res.end(response.bodyText ?? JSON.stringify(response.body));
  } catch (error) {
    requests.push({ symbol, period1, period2, error: String(error) });
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake Yahoo listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
