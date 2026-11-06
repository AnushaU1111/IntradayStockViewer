// Manual check against real Yahoo through a running API. Never run in CI.
//   npm start (or npm run dev -w @isv/backend), then: npm run smoke:live
// An upstream outage or rate limit here is not a defect; note it in DECISIONS and move on.

const API = process.env.API_URL ?? "http://localhost:3001";
const checks = [
  { symbol: "TSLA", expect: 200 },
  { symbol: "ZZZZNOTREAL1", expect: 404 },
];

let failed = false;
for (const { symbol, expect } of checks) {
  const url = `${API}/api/v1/stocks/${encodeURIComponent(symbol)}/daily-summary`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json();
    const summary = Array.isArray(body)
      ? `${body.length} days, last ${JSON.stringify(body.at(-1))}`
      : `${body.code}: ${body.detail}`;
    const ok = res.status === expect;
    failed ||= !ok;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${symbol}: HTTP ${res.status} (expected ${expect}); ${summary}`,
    );
    console.log(
      `     tz=${res.headers.get("x-exchange-timezone")} partial=${res.headers.get("x-partial-day")} cache=${res.headers.get("cache-control")}`,
    );
  } catch (err) {
    failed = true;
    console.log(`FAIL ${symbol}: ${String(err)} (is the API running at ${API}?)`);
  }
}
process.exitCode = failed ? 1 : 0;
