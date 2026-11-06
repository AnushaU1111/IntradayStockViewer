// Captures Yahoo Finance chart responses as test fixtures.
// Run by hand, never in CI:  node scripts/capture.mjs [SYMBOL | name=SYMBOL ...]
//
// Writes two copies per symbol:
//   backend/test/fixtures/yahoo/<name>.json  committed; only allowlisted headers are kept
//   fixtures-raw/<name>.json                 gitignored; all headers, for diagnosis
// Response headers can carry cookies, so only the allowlist reaches git (DECISIONS D-45).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "backend", "test", "fixtures", "yahoo");
const RAW_DIR = path.join(ROOT, "fixtures-raw");

const BASE_URL = process.env.YAHOO_BASE_URL ?? "https://query1.finance.yahoo.com";
const USER_AGENT =
  process.env.YAHOO_USER_AGENT ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HEADER_ALLOWLIST = ["content-type", "retry-after"];
const DAY_SECONDS = 86_400;
const PAUSE_MS = 1_500;

// Each target exists to exercise one behavior from spec section 3.
const DEFAULT_TARGETS = [
  { name: "TSLA", symbol: "TSLA" }, // golden dataset and e2e: keep whole
  { name: "GSPC", symbol: "^GSPC" }, // index: null volume expected
  { name: "BTC-USD", symbol: "BTC-USD" }, // crypto: out of scope (422)
  { name: "VFIAX", symbol: "VFIAX" }, // mutual fund: no 15m data (422)
  { name: "unknown-symbol", symbol: "ZZZZNOTREAL1" }, // 404 shape
  { name: "TSLA.no-user-agent", symbol: "TSLA", userAgent: null }, // assumption A-01
];

function buildUrl(symbol, nowSeconds) {
  const url = new URL(`/v8/finance/chart/${encodeURIComponent(symbol)}`, BASE_URL);
  url.searchParams.set("interval", "15m");
  url.searchParams.set("period1", String(nowSeconds - 35 * DAY_SECONDS));
  url.searchParams.set("period2", String(nowSeconds));
  url.searchParams.set("includePrePost", "false");
  return url;
}

async function capture(target) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const url = buildUrl(target.symbol, nowSeconds);
  const headers = target.userAgent === null ? {} : { "User-Agent": target.userAgent ?? USER_AGENT };

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const bodyText = await res.text();
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    // Non-JSON bodies (for example a plain-text 429) are kept verbatim below.
  }

  const allHeaders = Object.fromEntries(res.headers.entries());
  const kept = Object.fromEntries(
    HEADER_ALLOWLIST.filter((h) => allHeaders[h] !== undefined).map((h) => [h, allHeaders[h]]),
  );

  const meta = {
    symbol: target.symbol,
    capturedAt: new Date(nowSeconds * 1000).toISOString(),
    userAgentSent: target.userAgent !== null,
    request: { path: url.pathname, query: Object.fromEntries(url.searchParams) },
  };
  const response = (h) => ({
    status: res.status,
    headers: h,
    ...(body === null ? { bodyText } : { body }),
  });

  await writeFile(
    path.join(FIXTURE_DIR, `${target.name}.json`),
    JSON.stringify({ capture: meta, response: response(kept) }, null, 2) + "\n",
  );
  await writeFile(
    path.join(RAW_DIR, `${target.name}.json`),
    JSON.stringify({ capture: meta, response: response(allHeaders) }, null, 2) + "\n",
  );

  return summarize(target, res.status, kept, body);
}

function summarize(target, status, headers, body) {
  const result = body?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const ts = result?.timestamp ?? [];
  const iso = (s) => (typeof s === "number" ? new Date(s * 1000).toISOString() : String(s));
  const nulls = (arr) => (arr ?? []).filter((v) => v === null).length;
  const regular = result?.meta?.currentTradingPeriod?.regular;

  return {
    name: target.name,
    status,
    retryAfter: headers["retry-after"] ?? null,
    error: body?.chart?.error ?? null,
    instrumentType: result?.meta?.instrumentType ?? null,
    granularity: result?.meta?.dataGranularity ?? null,
    timeZone: result?.meta?.exchangeTimezoneName ?? null,
    currency: result?.meta?.currency ?? null,
    bars: ts.length,
    firstBar: ts.length ? iso(ts[0]) : null,
    lastBar: ts.length ? iso(ts.at(-1)) : null,
    offGrid: ts.filter((t) => t % 900 !== 0).length,
    nullLow: nulls(quote?.low),
    nullHigh: nulls(quote?.high),
    nullVolume: nulls(quote?.volume),
    sessionStart: regular ? iso(regular.start) : null,
    sessionEnd: regular ? iso(regular.end) : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  // An argument is SYMBOL or name=SYMBOL; the name picks the output file, so a
  // second capture (for example TSLA.market-hours=TSLA) never overwrites TSLA.json.
  const targets = args.length
    ? args.map((arg) => {
        const [name, symbol] = arg.includes("=") ? arg.split("=", 2) : [arg, arg];
        return { name: name.replace(/[^A-Za-z0-9.-]/g, ""), symbol };
      })
    : DEFAULT_TARGETS;

  await mkdir(FIXTURE_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });

  const summaries = [];
  for (const [i, target] of targets.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
    try {
      const s = await capture(target);
      summaries.push(s);
      console.log(`${s.name}: HTTP ${s.status}, ${s.bars} bars`);
    } catch (err) {
      summaries.push({ name: target.name, failed: String(err) });
      console.error(`${target.name}: request failed: ${String(err)}`);
    }
  }

  await writeFile(path.join(RAW_DIR, "summary.json"), JSON.stringify(summaries, null, 2) + "\n");
  console.table(
    summaries.map(({ name, status, bars, granularity, instrumentType, offGrid }) => ({
      name,
      status,
      bars,
      granularity,
      instrumentType,
      offGrid,
    })),
  );
  console.log(
    `\nFixtures: ${path.relative(ROOT, FIXTURE_DIR)}\nRaw + summary: ${path.relative(ROOT, RAW_DIR)}`,
  );
}

await main();
