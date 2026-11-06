# DECISIONS.md

Design decisions and working assumptions for the intraday stock viewer. Where the brief was ambiguous, I made a call and recorded it here instead of waiting for confirmation.

Each entry has three parts: **Decision**, **Why it was necessary** and **Tradeoff accepted**. Entries marked **Revised** show every version (v1, v2 and onward), the current one last, plus why each change happened. Tags like `[#3]` refer to the first spec review. Tags like `[R2-#3]` refer to the second, pre-coding review; `[R2-A]` to `[R2-F]` refer to the corrections from verifying that review. Tags like `[R3-#2]` and `[R4-#2]` refer to the third and fourth reviews. All reviews happened on 2026-11-05.



---

## 1. Scope and contract

### D-01 Backend stack: Node.js + TypeScript
- **Decision:** Node.js + TypeScript (`strict` and `noUncheckedIndexedAccess`) for the API, React + Vite + TypeScript for the UI, in one npm-workspaces repo.
- **Why it was necessary:** The brief allows C# .NET 8+ or Node.js/TypeScript, so a choice had to be made. One language lets the API and UI share the symbol rule, error codes and response types.
- **Tradeoff accepted:** If the reviewing team is C#-first, .NET might read as a closer fit. Accepted, because both are explicitly allowed and a single typed codebase reduces drift between the two apps.

### D-02 Endpoint shape
- **Decision:** `GET /api/v1/stocks/{symbol}/daily-summary`. The symbol is a path parameter, the version is in the path, and no other parameters are accepted.
- **Why it was necessary:** The brief only says the endpoint "takes a stock symbol as a parameter." A path parameter identifies the resource, and versioning lets the contract evolve as the MVP grows.
- **Tradeoff accepted:** Interval and range can't be changed by clients. They're fixed by the brief, and adding query parameters later is non-breaking.

### D-03 Response body stays a bare array
- **Decision:** Return exactly `[{ day, lowAverage, highAverage, volume }]`, sorted by `day` ascending, with no wrapper object. Metadata travels in headers: `X-Exchange-Timezone`, `X-Currency`, `X-Partial-Day` and `X-Request-Id`.
- **Why it was necessary:** The brief specifies the format exactly, but the UI needs the timezone, currency and partial-day information.
- **Tradeoff accepted:** Headers are less discoverable than body fields, and they require same-origin serving or CORS `exposedHeaders` (D-29).

### D-04 Definition of lowAverage, highAverage and volume
- **Decision:** For each day, `lowAverage` is the mean of the 15-minute bars' `low` values and `highAverage` is the mean of their `high` values. `volume` is the sum of the bars' `volume`. All three use the same set of usable bars (D-14).
- **Why it was necessary:** The brief names the fields but doesn't define them.
- **Tradeoff accepted:** A reader could expect daily low and high extremes instead. The UI labels say "Average of 15-min lows and highs" to prevent that reading.

### D-05 No authentication in the MVP
- **Decision:** No user accounts, login, password hashing or CSRF protection. Security effort goes to input validation, rate limiting, safe error output and security headers.
- **Why it was necessary:** The quality checklist mentions authentication, but the app has no users, no writes and no cookies. Fake auth would add code without protecting anything.
- **Tradeoff accepted:** Anyone who can reach the API can use it. Rate limits bound the abuse, and auth can be added later as middleware.

### D-06 Instrument scope: equities, ETFs and indices only `[#10]` **Revised**
- **v1:** Implicitly any symbol Yahoo returns. Validation tests listed BTC-USD, EURUSD=X and ES=F as valid inputs.
- **v2 (current):** Only `meta.instrumentType` values EQUITY, ETF and INDEX are supported. Anything else returns 422 `UNSUPPORTED_INSTRUMENT`. Day-key logic sits behind a per-type strategy interface.
- **Why it changed:** Crypto trades 24/7, futures sessions cross midnight and forex reports zero volume. Calendar-date grouping would silently give wrong "days" for them.
- **Why it was necessary:** The brief's example is a stock, and correctness beats breadth.
- **Tradeoff accepted:** Crypto, forex and futures lookups fail with a clear message instead of returning data. Adding them later means writing a new strategy, not reworking the core.

### D-07 The brief's sample record is illustrative only
- **Decision:** The sample row (TSLA, 2009-01-30) is used as a format example only, never as a test expectation.
- **Why it was necessary:** TSLA listed in June 2010, so the sample can't be real TSLA data.
- **Tradeoff accepted:** None. Test expectations come from an independent oracle instead (D-37).

---

## 2. Data window and upstream request

### D-08 Fetch window `[#2]` **Revised**
- **v1:** `range=1mo&interval=15m&includePrePost=false`, relying on Yahoo's definition of one month.
- **v2 (current):** Request `period1 = now - 35 days` and `period2 = now`, with `interval=15m` and `includePrePost=false`. Then filter the results to the window defined in D-09.
- **Why it changed:** Yahoo's `range=1mo` start point isn't documented and can begin mid-day, which produces a partial first day.
- **Why it was necessary:** The brief's sample curl has no `range` at all, so it defaults to one day and can't satisfy "last month."
- **Tradeoff accepted:** About 25 percent more data is fetched than is returned, which is negligible at 15-minute granularity.

### D-09 Definition of "last month" `[#2]` **Revised**
- **v1:** Trailing month as Yahoo defines it (about 21 to 23 trading days).
- **v2 (current):** Exchange-local calendar dates from (today minus 1 calendar month) to today, inclusive. Month ends clamp, so Mar 31 maps to Feb 28 or 29. "Today" means the exchange-local date of an injected clock.
- **Why it changed:** v1 depended on undocumented Yahoo behavior and couldn't be tested deterministically.
- **Why it was necessary:** "Last month" could mean a trailing month or the previous calendar month.
- **Tradeoff accepted:** The day count varies with month length and holidays. That's documented in the README.

### D-10 Regular session only
- **Decision:** Set `includePrePost=false`, so pre-market and after-hours bars are excluded.
- **Why it was necessary:** Extended-hours bars are thin and would distort the averages. The brief's sample doesn't include them.
- **Tradeoff accepted:** Extended-hours activity isn't represented in the results.

### D-11 Verify the returned granularity `[#2]` `[R2-#4]` **Revised**
- **v1:** No check; trust that Yahoo returns 15-minute bars.
- **v2:** Check that `meta.dataGranularity` is `15m` and that bar timestamps are multiples of 900 seconds. Otherwise return 422 `INTRADAY_UNAVAILABLE`.
- **v3 (current):** Check `meta.dataGranularity === "15m"` only. Otherwise return 422 `INTRADAY_UNAVAILABLE`.
- **Why it changed:** v1 could silently aggregate coarser data. The alignment check in v2 was speculative: an exchange whose session doesn't start on a 15-minute UTC boundary would fail it and get a 422 for its whole valid history.
- **Why it was necessary:** Yahoo can return coarser data for some symbols, such as mutual funds.
- **Tradeoff accepted:** If Yahoo ever mislabels granularity, the check won't notice. That was judged less likely than rejecting real data.

### D-12 Today's partial day is included `[#15]` **Revised**
- **v1:** Include today's bars. The UI marks a day "in progress" when it equals today in the exchange timezone.
- **v2:** Include today's bars. The backend sets `X-Partial-Day` only while the regular session is open, based on `meta.currentTradingPeriod.regular.end`. The UI shows the badge only for the date in that header.
- **v3 (current) `[R3-#3]`:** The mapper carries both `sessionStart` and `sessionEnd`. The header is set to today's exchange-local date only when `sessionStart <= now < sessionEnd`, and omitted if either value is missing.
- **Why it changed:** v1 was wrong after the close and on half days, and the UI had no reliable way to know the session times. v2 named only the end, so "is the session open" couldn't be decided before the open.
- **Why it was necessary:** Today's averages and volume change during market hours, and users should know that.
- **Tradeoff accepted:** A small amount of extra backend logic, plus reliance on Yahoo's trading-period metadata.

---

## 3. Aggregation rules

### D-13 Group by exchange-local date using IANA timezones `[#3]` **Revised**
- **v1:** Group by the exchange's local date using `meta.exchangeTimezoneName`. Behavior when the timezone is missing was undefined.
- **v2 (current):** Convert each bar with `Intl.DateTimeFormat` and the IANA zone. If the zone is missing or invalid, return 502 `UPSTREAM_BAD_RESPONSE`. Never fall back to UTC or `meta.gmtoffset`.
- **Why it changed:** The review found that a fallback would silently misgroup bars. `gmtoffset` is only the current offset, and US DST ended on 2026-11-01, inside the data window.
- **Why it was necessary:** The brief says "group by day" without naming a timezone. UTC or server-local grouping puts bars on the wrong date for some markets.
- **Tradeoff accepted:** A Yahoo response without timezone metadata becomes an error instead of approximate data.

### D-14 One "usable bar" rule for every field `[#1]` `[#4]` **Revised**
- **v1:** Section 4.3 averaged and summed over usable bars only, but test A1 summed volume from bars with invalid prices. The two contradicted each other. A bar with `low > high` was kept with a warning.
- **v2 (current):** A bar is usable only if:
  - `low` and `high` are finite, `low <= high` and both are above 0
  - `volume` is null (counted as 0) or a safe, non-negative integer

  Unusable bars are excluded from the averages and the volume sum alike.
- **Why it changed:** The contradiction had to be resolved, and keeping inverted bars let corrupt data into the averages.
- **Why it was necessary:** Yahoo returns nulls and occasional inconsistent bars, so the brief's "group by day" needs a precise input definition.
- **Tradeoff accepted:** Volume from a bar with bad prices is dropped, which can undercount slightly. One consistent rule was worth more than that small precision.

### D-15 Null volume counts as zero
- **Decision:** A bar with valid prices and `volume: null` stays usable and contributes 0 to the volume sum.
- **Why it was necessary:** Indices often report no volume. Dropping those bars would empty out index results.
- **Fixture check:** ^GSPC actually reports real volume (for example 115,760,548 in its first bar), so the premise was wrong for this index. The rule stays because it does no harm, and nulls still occur on empty bars (A-04).
- **Tradeoff accepted:** A genuinely missing volume value looks the same as zero volume.

### D-16 Duplicates and ordering `[#4]` `[R2-#4]` **Revised**
- **v1:** Sort bars by timestamp. For duplicates with identical values keep one; with different values keep the last and log a warning. Drop a bar whose timestamp isn't on a 900-second boundary and falls inside an aligned bar's interval, treating it as a live tick.
- **v2 (current):** The same sorting and duplicate rules, with replaced duplicates counted in the diagnostics (D-33). No live-tick rule.
- **Why it changed:** The live-tick rule was built on an unverified assumption (A-05) and could discard real Yahoo data. A rule is added only if a fixture captured during market hours shows such a bar, and then only as narrow as the evidence.
- **Why it was necessary:** Without sorting and duplicate handling, repeated bars would double-count volume and skew the averages.
- **Tradeoff accepted:** "Keep last" assumes later values are corrections. If live ticks do exist, today's partial day could briefly double-count until the rule is added.

### D-17 Days with no usable bars are omitted
- **Decision:** A day with zero usable bars doesn't appear in the response.
- **Why it was necessary:** An average over zero bars is undefined, and returning nulls would break the specified numeric types.
- **Tradeoff accepted:** Gaps in the output, such as a halted day, are silent. Holidays are absent anyway.

### D-18 Volume overflow guard `[#4]`
- **Decision:** If a running volume sum exceeds `Number.MAX_SAFE_INTEGER`, return 502 `UPSTREAM_BAD_RESPONSE`.
- **Why it was necessary:** JSON numbers beyond 2^53 lose precision in clients.
- **Tradeoff accepted:** None in practice, since no in-scope instrument comes near that limit. This only guards against corrupt data.

---

## 4. Precision and rounding

### D-19 Decimal arithmetic, rounded half up once `[#5]` **Revised**
- **v1:** Compute in floating point, then round to 4 decimals half away from zero with a "float-safe helper."
- **v2 (current):** Sum and divide with `decimal.js`, which builds each value from its shortest decimal string. Round once at the end to 4 places with `ROUND_HALF_UP` and normalize `-0` to `0`.
- **Why it changed:** Floating-point sums can turn a true tie into x.xxxx4999. A hand-rolled helper was a correctness risk.
- **Correction to v2's example `[R2-#1]`:** v2 originally cited the mean of 1.0001 and 1.0002 as a float failure. Running it in Node shows it isn't one: float gives 1.0001500000000001, which rounds to 1.0002, the same as decimal. Verified failures are 1.0 and 1.0001 (float 1.0, decimal 1.0001) and 1.0002 and 1.0003 (float 1.0002, decimal 1.0003). In 200,000 random days of cent-priced bars, 1,511 rounded differently.
- **Why it was necessary:** The brief specifies 4-decimal precision.
- **Tradeoff accepted:** One extra dependency. Prices arrive with float32 noise (for example 249.9600067138672), so the rule is defined against values as received, not "true" prices.

### D-20 JSON numbers, not strings
- **Decision:** Averages are JSON numbers with at most 4 decimals. Trailing zeros are dropped by serialization, so 40.2950 appears as 40.295.
- **Why it was necessary:** The brief's sample shows numbers, not strings.
- **Tradeoff accepted:** Consumers who need fixed-width display must format the values themselves. The README documents this.

### D-21 Sub-penny prices are a known limitation `[#5]`
- **Decision:** Keep the 4-decimal contract even for very low-priced instruments.
- **Why it was necessary:** The contract is mandated by the brief.
- **Tradeoff accepted:** Prices below 0.00005 round to 0. This is documented, not worked around.

---

## 5. Input validation

### D-22 Symbol validation order and allowlist `[#9]` `[R2-#6]` **Revised**
- **v1:** Trim, uppercase, then validate against `^\^?[A-Z0-9][A-Z0-9.\-=]{0,19}$` (max 21 characters).
- **v2:** Trim, then check the raw input against an ASCII-only, case-insensitive allowlist `^\^?[A-Za-z0-9][A-Za-z0-9.&=-]{0,31}$`, and uppercase only after it passes. Intended max 32 characters.
- **v3 (current):** Same order, with the length enforced by a lookahead over the whole string: `^(?=.{1,32}$)\^?[A-Za-z0-9][A-Za-z0-9.&=-]*$`. Boundary tests cover 32 and 33 characters, with and without `^`.
- **Why it changed:** v1 uppercased first, which let Unicode lookalikes through: `"ſ".toUpperCase()` is `S` and `"ı".toUpperCase()` is `I`. v1 also rejected real symbols such as M&M.NS and long option symbols. v2's optional caret sat outside the counted part, so it accepted 33 characters.
- **Why it was necessary:** The symbol goes into an upstream URL and a cache key, so it must be strictly bounded.
- **Tradeoff accepted:** Some exotic real symbols may still be rejected. The allowlist is in one module, so widening it is easy.

### D-23 One validation implementation for API and UI `[#16]` **Revised**
- **v1:** The same rule was "mirrored" in the frontend, and a shared types package was deferred.
- **v2 (current):** The rule lives in `packages/shared` (npm workspaces) and is imported by both apps, along with the error codes and the response type.
- **Why it changed:** A mirrored copy contradicts "single source of truth" and drifts over time.
- **Why it was necessary:** Client and server must never disagree on what a valid symbol is.
- **Tradeoff accepted:** A slightly more complex workspace setup.

### D-24 No ticker notation rewriting `[#9]`
- **Decision:** Never translate notation, such as rewriting `BRK.B` to `BRK-B`. When a 404 matches a share-class pattern, add a hint to the error detail instead.
- **Why it was necessary:** Users type exchange notation, but Yahoo uses its own.
- **Tradeoff accepted:** Users must retype the symbol. An automatic rewrite could silently fetch a different listing.

---

## 6. Errors and upstream resilience

### D-25 Problem+json for every error `[#13]` **Revised**
- **v1:** Our own errors used RFC 9457 problem+json. Fastify's built-in 404, 429 and 500 responses weren't addressed.
- **v2 (current):** `setErrorHandler`, `setNotFoundHandler` and the rate-limit plugin's `errorResponseBuilder` all emit problem+json with `type`, `title`, `status`, `detail`, `code` and `requestId`. Upstream bodies and stack traces are never echoed.
- **Why it changed:** Framework defaults would have broken the contract on exactly the error paths clients hit most.
- **Why it was necessary:** The UI maps messages from a stable `code`, so every error response needs the same shape.
- **Tradeoff accepted:** A few more handlers and tests.

### D-26 Upstream error classification `[#8]` **Revised**
- **v1:** Seven cases, with other upstream 4xx mapped to 502 `UPSTREAM_BAD_REQUEST`. 403, errors inside a 200 response and unsupported data had no rule.
- **v2 (current):**

  | Upstream result | Our response |
  | --- | --- |
  | Malformed symbol (rejected before any call) | 400 `INVALID_SYMBOL` |
  | Unknown symbol, including a "Not Found" error inside a 200 | 404 `SYMBOL_NOT_FOUND` |
  | Instrument type out of scope | 422 `UNSUPPORTED_INSTRUMENT` |
  | No 15-minute data | 422 `INTRADAY_UNAVAILABLE` |
  | Valid symbol, no usable bars | 200 `[]` |
  | Yahoo 429 | 503 `UPSTREAM_RATE_LIMITED` |
  | Yahoo 401 or 403 | 503 `UPSTREAM_BLOCKED` |
  | Yahoo 400 or 422 | 502 `UPSTREAM_REJECTED` |
  | Bad payload | 502 `UPSTREAM_BAD_RESPONSE` |
  | Yahoo 5xx or network failure | 502 `UPSTREAM_UNAVAILABLE` |
  | Deadline exceeded | 504 `UPSTREAM_TIMEOUT` |

- **Why it changed:** The review found ambiguous and missing cases.
- **Why it was necessary:** The brief requires handling for invalid symbols and failed requests, and the UI needs distinct, honest messages.
- **Tradeoff accepted:** More codes to test and document.

### D-27 One request deadline `[#6]` **Revised**
- **v1:** 5 seconds per attempt, 2 retries and a "10 second total budget." Three 5-second attempts plus backoff can't fit in 10 seconds.
- **v2 (current):**
  - One 8-second deadline covers queueing, every attempt and the backoff between attempts.
  - Each attempt gets the smaller of 3 seconds and the time remaining.
  - Backoff is 200 ms, then 600 ms, with jitter.
  - No new attempt starts with less than 1 second left.
  - The client-side timeout is 10 seconds.
- **Why it changed:** The v1 numbers contradicted each other.
- **Why it was necessary:** Without a hard deadline, slow upstream calls tie up server resources and users wait indefinitely.
- **Tradeoff accepted:** A slow-but-working Yahoo response over 3 seconds is cut off and retried rather than awaited.

### D-28 Retry ownership and cooldown `[#7]` **Revised**
- **v1:** The backend retried transient errors, and the frontend also retried 5xx responses once.
- **v2:**
  - The backend owns all retries, and only for 5xx, network errors and attempt timeouts.
  - The UI auto-retries only a network failure, once. A 503 retry button is disabled until `Retry-After` elapses.
  - After a Yahoo 429, 401 or 403, all requests skip the upstream for 30 seconds (global cooldown).
- **v2 draft, rejected `[R2-D]`:** Parse Yahoo's `Retry-After` and clamp it to 5 to 300 seconds. Rejected because resuming earlier than Yahoo asks risks a longer block.
- **v3:**
  - Retry ownership as in v2.
  - The cooldown length is Yahoo's `Retry-After`, honored exactly (seconds or HTTP date). 30 seconds is used only when the header is missing or can't be parsed.
  - When the cooldown ends, a single probe request goes upstream first (half-open). Success reopens normal traffic; another 429 or 403 starts a new cooldown.
  - Our 503's `Retry-After` is the remaining cooldown, rounded up.
- **v4 (current) `[R3-#2]` `[R3-#6]`:** v3, with every transition defined:

  | Probe outcome | Next state |
  | --- | --- |
  | Any non-block Yahoo answer: 2xx, 404, 400, 422 or a malformed payload | Closed |
  | 429, 401 or 403 | Open, for `Retry-After` or 30 s |
  | 5xx, network error or attempt timeout | Open, 30 s |

  - The probe is the first real request after the cooldown, with one attempt, a 3 s timeout and no retries.
  - Requests arriving while the probe is in flight get 503 with `Retry-After: 2`. Nothing is queued, so nothing bursts when the probe settles.
  - The probe settles in `finally`, so the state can't stick in half-open. There is no background timer.
  - Cache hits are served in every state.
  - Every 429 and 503 the API sends carries `Retry-After`. The UI disables Retry and counts down from it, using 5 s if it's missing.
  - `[R4-#3]` The countdown belongs to the symbol that failed. A search for a different symbol goes out at once, so the backend can serve it from cache or return its own typed 503. Before this, a TSLA rate limit would have blocked an AAPL search the backend could have answered from cache.
- **Why it changed:** v1 let frontend retries of a 503 multiply traffic exactly when Yahoo was rate-limiting us. v2 ignored Yahoo's own backoff signal, and ending a cooldown released every queued request at once. v3 defined only two probe outcomes, so a probe that timed out or hit a 500 or 401 had no defined next state. That could leave traffic blocked forever or release a burst.
- **Why it was necessary:** Yahoo's limit applies to our server's IP, so it's shared by every user.
- **Tradeoff accepted:** A long `Retry-After` from Yahoo means a long outage for every user. Honoring it is still cheaper than being blocked for longer.

---

## 7. Caching and rate limiting

### D-29 Same-origin serving; CORS off by default `[#14]` **Revised**
- **v1:** A CORS allowlist defaulting to `http://localhost:5173`, with the frontend's API URL set at build time.
- **v2 (current):**
  - In Docker, nginx serves the built SPA and proxies `/api` and `/health` to the API. In development, the Vite proxy does the same.
  - The frontend uses a relative `/api` base URL.
  - CORS is only enabled when `CORS_ORIGINS` is set, and then lists the `X-` headers in `exposedHeaders`.
  - nginx owns the SPA's CSP (`default-src 'self'`). The API sends `default-src 'none'; frame-ancestors 'none'`.
- **Why it changed:** Without `exposedHeaders`, browsers hide custom headers cross-origin, which broke D-03. Build-time URLs also made the bundle environment-specific.
- **Why it was necessary:** The UI must be able to read the metadata headers.
- **Tradeoff accepted:** Docker adds an nginx container. If Docker is not delivered, the Vite proxy keeps local runs same-origin.

### D-30 Cache rules by outcome `[#11]` **Revised**
- **v1:** A 60-second TTL cache keyed by symbol, with unknown symbols cached for 30 seconds. Failure caching and coalescing cleanup weren't specified.
- **v2:**
  - 200 responses (including empty) and 422s are cached for 60 seconds, and 404s for 30 seconds.
  - 429s, 5xx, timeouts and bad payloads are never cached.
  - `Cache-Control` sends `max-age` equal to the seconds left, or `no-store` for errors.
  - The cache is an LRU bounded at 500 entries.
  - Coalesced in-flight requests are removed in `finally`, so a shared failure is never reused.
- **v3 (current) `[R2-#7]` `[R2-C]`:** The cache sits in front of the provider and stores provider data, not API responses. Only three kinds of value are allowed:
  - `{ bars, info }` from a successful fetch, including one with no bars: 60 seconds
  - `UnsupportedInstrument` or `IntradayUnavailable` (422): 60 seconds
  - `SymbolNotFound` (404): 30 seconds

  Every other outcome is never cached. The service recomputes the window, aggregation and `X-Partial-Day` on every request from the current clock. `Cache-Control`, the LRU bound and coalescing are unchanged from v2.
- **Why it changed:** v1 left failure caching undefined, which could serve errors for a full minute or reuse a rejected promise. v2 cached finished responses, so an entry made just before midnight or before the close could carry yesterday's window or a stale partial-day flag. An early v3 draft said "a domain error" could be cached, which was too broad.
- **Why it was necessary:** Yahoo is rate-limited and data changes at most every 15 minutes.
- **Tradeoff accepted:** Aggregation reruns on every request, which costs microseconds for about 1,000 bars. Browsers may still hold a response for up to 60 seconds. The cache is in-memory and per instance until Redis replaces it.

### D-31 Global upstream limiter and proxy trust `[#12]` `[R2-A]` **Revised**
- **v1:** A token bucket limits upstream calls to 2 per second, with a queue of 20; a full queue returns 503 `SERVER_BUSY`. A per-IP limit of 60 requests per minute. `TRUST_PROXY` defaults to `false` and is set to the hop count (`1`) behind nginx.
- **v2:** Same limiter and per-IP limit. Proxy trust changes:
  - Fastify is pinned to 5.12.1 or later.
  - `TRUST_PROXY` accepts only `false`, an IP or a CIDR range. A number fails config validation at startup.
  - The Docker compose network has a fixed subnet and nginx a static IP; `TRUST_PROXY` is that IP.
  - The API port is not published, so only nginx can reach it. nginx overwrites `X-Forwarded-For` with `$remote_addr`.
- **Why it changed:** A Fastify advisory (GHSA-3m5p-2c4r-xxw2, CVE-2026-16732, published 2026-09-02) showed that a numeric hop count trusts forwarded headers without checking the connecting address. Anyone reaching the API directly could spoof them. Fastify 5.12.1 disables the numeric form. The v1 advice came from AI guidance that predated the advisory; verifying it caught the problem.
- **v3 `[R3-#1]` `[R3-#5]` `[R3-#6]`:**
  - Fastify is at least 5.12.6, installed as the latest patched 5.x release and locked in the committed `package-lock.json`. `npm audit` in CI catches later advisories.
  - IP/CIDR-only proxy trust and its tests are Must.
  - The Docker topology (fixed subnet, static nginx IP, unpublished API port) is Should and ships with Docker.
  - The global limiter is Should. When it ships, `SERVER_BUSY` carries `Retry-After` = ceil((queue length + 1) / `UPSTREAM_MAX_RPS`), at least 1.
  - The per-IP 429 is `RATE_LIMITED` and always carries `Retry-After`.
- **v4 (current) `[R4-#2]`:** v3, with the Fastify floor raised to 5.12.8 for CVE-2026-120216 (published 2026-11-02). That bug crashes the process when a streaming response outlives a nonzero `handlerTimeout`. We stream nothing and leave `handlerTimeout` at 0, since the upstream guard enforces the deadline. So this is a floor bump, not a live exposure.
- **Why it changed:** A header-validation bypass affecting Fastify 5.12.2 to 5.12.5, fixed in 5.12.6 (GHSA-389g-gv7q-r4x8), showed that a fixed "or later" floor goes stale. The lockfile and `npm audit` stop that from recurring silently. The limiter and Docker had read as required in places, and `SERVER_BUSY` had no `Retry-After` even though the UI needed one for its countdown.
- **Why it was necessary:** Rotating symbols bypasses the per-symbol cache, and behind a proxy every request otherwise appears to come from the proxy's IP.
- **Tradeoff accepted:** The compose file has to hard-code a subnet and an IP. Bursts of distinct symbols queue up or get 503. Limits are per instance until shared state exists.

---

## 8. Architecture

### D-32 Yahoo mapper boundary and domain errors `[#16]` **Revised**
- **v1:** The pure aggregation function took Yahoo's parallel arrays directly, and Yahoo-specific errors were visible above the provider.
- **v2 (current):** A Yahoo mapper validates and converts payloads into `IntradayBar[]` and `InstrumentInfo`. The domain throws its own errors (`SymbolNotFound`, `UnsupportedInstrument`, `IntradayUnavailable`, `ProviderUnavailable`, `ProviderRateLimited`, `ProviderBadResponse`), and one handler maps them to HTTP responses.
- **Why it changed:** Upstream shapes were leaking into the domain, which contradicted the "swap the provider" claim.
- **Why it was necessary:** It keeps business rules testable and makes the data source replaceable.
- **Tradeoff accepted:** One extra mapping layer.

### D-33 Pure domain with an injected clock `[R2-#9]` **Revised**
- **v1:** `aggregateDaily(bars, info, now)` has no framework, HTTP or Yahoo imports, and is expected to "log warnings" for unusable bars. Dependencies, including the clock, are wired in `buildApp(deps)`.
- **v2 (current):** `aggregateDaily` returns `{ days, diagnostics }`, where diagnostics counts unusable bars by reason and replaced duplicates. The service logs non-zero counters at `warn` and records metrics. The function imports nothing that logs.
- **Why it changed:** Logging from inside the function contradicted calling it pure.
- **Why it was necessary:** Window, timezone and partial-day logic all depend on "now." An injected clock and a pure function make them deterministic in tests, and tests can assert the diagnostics directly.
- **Tradeoff accepted:** A slightly larger return type and more wiring code.

### D-34 Libraries **Revised** `[Phase 6]`
- **v1:** Fastify 5.12.8 or later, locked by the lockfile (see D-31) with helmet, cors and rate-limit plugins; zod; decimal.js; native `fetch` with `AbortSignal`; `Intl` for timezones; TanStack Query; Recharts, lazy-loaded.
- **v2 (current):** The same, without Recharts. The chart is hand-built SVG (D-55). The frontend's runtime dependencies are React, React DOM, TanStack Query and two self-hosted `@fontsource` font packages.
- **Why it changed:** The chosen design needed marks Recharts doesn't draw well (D-55).
- **Why it was necessary:** Each one replaces code that would otherwise be hand-written and need its own tests.
- **Tradeoff accepted:** About ten runtime dependencies to maintain. No database, queue or auth service.

### D-35 Health checks never call Yahoo
- **Decision:** `/health/live` checks that the process is up. `/health/ready` checks config only.
- **Why it was necessary:** A Yahoo outage shouldn't make our service look unhealthy or block deployments.
- **Tradeoff accepted:** "Ready" doesn't guarantee the upstream is reachable.

---

## 9. Frontend

### D-36 UI renders API facts; never infers market state `[#15]`
- **Decision:**
  - `day` is rendered as a string, never through `new Date(day)`, which shows the previous day in US timezones.
  - The partial-day badge is driven only by the `X-Partial-Day` header.
  - Axis labels say "Average of 15-min lows and highs ({currency})."
  - History is pushed only when the symbol changes, and an invalid symbol in the URL makes no request.
- **Why it was necessary:** Each of these was a source of wrong output.
- **Tradeoff accepted:** The UI depends on API headers for context.

### D-40 Separate cancelled, timed-out and failed requests `[R2-#8]`
- **Decision:** The API client combines the caller's abort signal with a 10-second timeout and classifies how a request ended:

  | Cause | Detected by | Shown | Auto-retried |
  | --- | --- | --- | --- |
  | Superseded by a newer search | Caller's signal aborted | No | No |
  | Client timeout | `DOMException` named `TimeoutError` | Yes | No |
  | Network failure | `TypeError` from `fetch` | Yes | Once |

- **Why it was necessary:** Treating every rejected `fetch` as a network failure would retry or display a request the user had already replaced, and would auto-retry against a server that may be overloaded.
- **Tradeoff accepted:** Relies on `AbortSignal.any`, which needs a current browser.
- **Addendum `[R4-#5]`:** The form stays enabled while loading, so "a new search cancels the in-flight one" is actually reachable. An earlier spec disabled the submit button during loading, which made cancellation impossible from the UI. The test drives the rendered form, not the API client.
- **Addendum `[R5-#6]`:** Network errors are classified only around the `fetch()` call. Reading or parsing the body is a separate step, and any failure there becomes `bad_response`, which is never auto-retried. Without the split, a body-read failure (which can also surface as a `TypeError`) would have been mistaken for a network failure and retried.

### D-45 Test fixtures: whole, sliced and sanitized `[R5-#1]` `[R5-#3]` `[R5-#4]` `[R5-#9]`
- **Decision:**
  - The TSLA fixture is kept whole, all 35 days, so tests cover the start of the window.
  - One helper, `sliceFixture`, cuts every parallel array by the same indices for `period1 <= t < period2`. Unit test A11 and the fake Yahoo server both use it, so the in-session input matches what Yahoo would have returned at 18:00 UTC.
  - The time cutoff lives at that fixture/provider boundary, never in `aggregateDaily`.
  - Captured fixtures keep only the `content-type` and `retry-after` headers. Raw captures stay in a gitignored folder.
  - If the captured session times don't match the e2e clocks, a script derives a labeled synthetic fixture, recorded here. The original capture is never edited.
- **Why it was necessary:** The plan compared the full after-close fixture against the in-session expected values, which would fail even with correct aggregation, or invite a time filter inside the domain. Trimming by hand could hide the window's start and misalign arrays. Response headers can carry cookies.
- **Tradeoff accepted:** A larger committed fixture and one more test helper.

### D-43 Chart labels degrade gracefully `[R4-#6]`
- **Decision:**
  - The price axis reads "Average of 15-min lows and highs (USD)" when `X-Currency` is present, and the same words with no unit when it isn't.
  - The volume axis reads "Volume", not "Shares".
- **Why it was necessary:** `X-Currency` is optional (D-41), and indices don't report share counts.
- **Tradeoff accepted:** Without a currency, users must infer the unit from the symbol.

### D-44 Timestamp values are validated, not just counted `[R4-#4]`
- **Decision:** Every `timestamp` element must be a safe integer of Unix seconds from 0 to 8,640,000,000,000 (the JavaScript `Date` limit). Any other value (fractional, negative, non-finite, a string, null or out of range) makes the payload malformed: 502 `UPSTREAM_BAD_RESPONSE`, with no partial result.
- **Why it was necessary:** Earlier validation checked array lengths only. A bad timestamp would produce an `Invalid Date` day key or a wrong day silently.
- **Tradeoff accepted:** One bad timestamp fails the whole request instead of dropping that bar. A corrupt time axis means the rest of the payload can't be trusted either.

### D-55 Hand-built SVG chart instead of Recharts `[Phase 6]`
- **Decision:** `ResultsChart.tsx` draws the chart as plain SVG in React:
  - one capsule per day from the average low to the average high, over a soft band through the highs and lows;
  - volume bars below on the same date axis;
  - a crosshair, a price tag on the right axis, a date tag and a legend for the focused day;
  - the latest value tagged on the axis, and the `X-Partial-Day` bar in its own color with "Still trading".

  It is keyboard operable: arrow keys, Home and End move between days and announce them, and Tab leaves the chart. Hovering a table row moves the chart, and the chart highlights its row.
- **Why it was necessary:** The approved design needs marks Recharts doesn't provide as components (axis tags, a floating date tag, a band behind range bars, a pulsing live marker). Building them on top of Recharts would mean custom shapes for most of the chart, plus a large dependency that pulls in d3 modules. Plain SVG also makes the spec's label rules (D-43) and the badge rule (D-36) direct to test.
- **Tradeoff accepted:** About 400 lines of chart code to maintain, including a small tick-scale helper (`lib/scale.ts`). No lazy loading is needed, since the whole app is about 87 KB gzipped.

---

## 10. Testing and delivery

### D-37 Tests with independent oracles `[#17]` `[#18]` `[R2-#1]` `[R2-#3]` **Revised**
- **v1:** About 35 tests. Playwright ran against a mocked API. Timezone tests used a US bar at 15:45 ET, and the rounding test used a single value of 1.00005.
- **v2:**
  - Expected values come from `scripts/golden.py` (Python `Decimal`) or hand calculation, never from the code under test.
  - Timezone tests use cases that fail under UTC or fixed-offset grouping: a Sydney bar, and a New York bar at 00:30 EDT on 2026-10-31.
  - The rounding test uses lows of 1.0001 and 1.0002, expecting 1.0002.
  - CI runs the backend suite under three host timezones, and Playwright runs with two browser timezones.
  - Real-stack end-to-end tests run the built UI and real API against a fake Yahoo server.
- **v3 (current):** v2, with three changes:
  - **Rounding test:** uses verified failing ties (1.0 and 1.0001 give 1.0001; 1.0002 and 1.0003 give 1.0003). The test also asserts that naive float rounding gets them wrong, proving it can fail.
  - **Fixed clock:** the API reads `CLOCK_FIXED_AT`, honored only when `NODE_ENV=test`, and `golden.py` uses the same value. End-to-end tests run twice, after the close and during the session.
  - **One backend clock per e2e run `[R4-#1]`:** a backend has one clock, so the after-close (E1, E2) and in-session (E1b, E1c) scenarios run as two Playwright runs. Each run starts fresh servers with `reuseExistingServer: false`, builds the backend first and uses its own golden file. The earlier config started a single backend with a single clock, so the two-clock tests couldn't both have been correct.
  - **Fake Yahoo honors the request window `[R3-#4]`:** the fake server returns only bars with `period1 <= t < period2`, and `golden.py` produces one golden file per clock value. Test E1c checks that no bar at or after the in-session clock reaches the API. Without this, the in-session run would have aggregated afternoon bars that couldn't exist yet at 18:00 UTC and still passed.
  - **Preview proxy:** `vite preview` and the dev server both proxy `/api` and `/health` explicitly.
- **Why it changed:** The v1 tests could pass on wrong implementations: US regular hours never cross the UTC date line, 1.00005 has no exact binary form and mocked browser tests didn't prove the two apps work together. In v2, the rounding test couldn't fail (float gets that pair right). And fixture dates were fixed while the clock wasn't, so end-to-end tests would start failing once the fixtures aged out of the window.
- **Why it was necessary:** The brief asks for thorough tests, and the evaluation weights edge cases.
- **Tradeoff accepted:** More test infrastructure: a fake server, a golden script, a CI matrix and a test-only clock setting that production must refuse.

### D-38 No real Yahoo calls in CI
- **Decision:** All automated tests use recorded fixtures. A live smoke script (`npm run smoke:live`) is for manual runs only.
- **Why it was necessary:** CI must be deterministic and can't depend on an unofficial, rate-limited API.
- **Tradeoff accepted:** A Yahoo format change is only caught by the manual smoke run or in production logs.

### D-39 Must and Should tiers `[#19]` **Revised**
- **v1:** A single plan whose cut order (Playwright first, then Docker, then coalescing) contradicted a definition of done that required them.
- **v2:**
  - **Must:** covers all critical fixes, the correctness-related high fixes and the real-stack end-to-end tests.
  - **Should, added in order:** global limiter, coalescing, URL history, proxy test, Docker, quick-pick chips.
  - The definition of done lists only Must items.
- **v3 (current) `[R2-#2]` `[R2-F]`:**
  - Tiers are set by importance, with no time estimates in the plan.
  - **Must:** everything correctness and security depend on, including the proxy-trust tests and real-stack end-to-end tests.
  - **Should, in order:** global limiter, coalescing, URL history, Docker with nginx, quick-pick chips.
  - Every test carries an M or S tag. A feature, its tests and its README text ship together or not at all.
  - The README is written last, from what was delivered.
  - `[R3-#5]` The spec marks every Should feature as Should wherever it appears: the requirements, architecture, file layout, tests and issue tracker. The definition of done lists only Must items.
- **Why it changed:** v1's plan and definition of done contradicted each other. In v2, Should features still appeared in the required tests, CI and README, and the plan carried time estimates, which are now left out of the plan and the prompt log.
- **Why it was necessary:** The brief values speed and a complete, working submission over a large, partly finished one.
- **Tradeoff accepted:** Docker and the global limiter might not ship. If so, they're documented as design and absent from the README. The Vite proxy keeps the app same-origin either way.

### D-41 Required and optional Yahoo metadata `[R2-#5]`
- **Decision:**
  - **Required** (missing means 502): `exchangeTimezoneName`, `instrumentType`, `dataGranularity`.
  - **Optional:** `currentTradingPeriod` (absent: no `X-Partial-Day`) and `currency` (absent: no `X-Currency`).
  - Unknown keys are ignored (`.passthrough()` on `meta`).
- **Why it was necessary:** A strict schema would turn a missing display-only field into a 502 for every request for that symbol.
- **Tradeoff accepted:** Without session metadata, a partial current day shows no badge.

### D-42 Valid empty vs malformed payloads `[R2-B]`
- **Decision:**
  - No `timestamp` key and no quote data is a valid empty result: 200 `[]`.
  - Timestamps present with missing or mismatched quote arrays is malformed: 502 `UPSTREAM_BAD_RESPONSE`.
  - A malformed payload is never turned into `[]`.
- **Why it was necessary:** Otherwise a Yahoo schema change would look like a stock with no trading history.
- **Tradeoff accepted:** If Yahoo ever sends timestamps without quote data for a genuinely empty result, users see a 502 until the rule is adjusted.

---

## 11. Toolchain and repository

### D-46 Toolchain versions
- **Decision:**
  - Node 24.14.1, pinned in `.nvmrc` and used by CI, with `engines` set to `>=24`.
  - TypeScript `~6.0.3`, not the newer 7.x.
  - ESLint 10 with typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`; Prettier for formatting; Vitest 5.
  - ESM throughout (`"type": "module"`).
  - No separate `pino` dependency, because Fastify ships it.
- **Why it was necessary:** typescript-eslint 8.72.1, the current release, declares `typescript >=4.8.4 <6.1.0` as a peer. TypeScript 7 would break type-aware linting. Pinning Node keeps local runs and CI identical.
- **Tradeoff accepted:** I stay one TypeScript major behind until typescript-eslint supports 7.

### D-47 Shared package resolved from source in development, from `dist` at runtime
- **Decision:** `@isv/shared` exports a custom `source` condition that points to `src/index.ts`, plus `types` and `default` conditions that point to `dist`.
  - Workspace `tsconfig`s and both Vitest configs use the `source` condition. The Vitest configs set it for both client and ssr resolution, because Vitest's default Node environment uses the ssr conditions.
  - Build configs turn the condition off (`customConditions: []`), so compiled output and Node at runtime use `dist`. The root `build` script builds workspaces in dependency order: shared, then backend.
- **Why it was necessary:** Without this, every test and typecheck would need a fresh build of the shared package first, or the backend build would pull shared source files outside its `rootDir`.
- **Tradeoff accepted:** One non-standard export condition, documented here, and a build order to respect.

### D-48 CI shape
- **Decision:** One job runs format check, lint, typecheck, production `npm audit --audit-level=high` and build. A second job runs all workspace tests in a matrix of `TZ=UTC`, `TZ=Pacific/Kiritimati` and `TZ=America/Los_Angeles`.
  - A guard test (`backend/test/timezone-matrix.test.ts`) fails if `TZ` is set but Node isn't using it. It was checked by running with an invalid zone.
  - `.gitattributes` forces LF line endings, so formatting checks behave the same on Windows and in CI.
- **Why it was necessary:** Timezone bugs depend on the host zone, and a matrix that never actually reaches Node would pass silently. Development happens on Windows while CI runs on Linux.
- **Tradeoff accepted:** Three test jobs per push instead of one. The suite is small, so the cost is negligible.
- **Update after CI run 1:** Bumped `actions/checkout` and `actions/setup-node` from v4 to v7. v4 targets the deprecated Node 20 runtime and produced 4 warnings, and I confirmed both v7 `action.yml` files declare `node24`. I also pinned the runner to `ubuntu-24.04` instead of `ubuntu-latest`, which GitHub is migrating to Ubuntu 26, so the CI image doesn't change underneath the project.

### D-49 Force a patched minimatch in dev tooling
- **Decision:** The root `package.json` has `"overrides": { "minimatch": "^11.0.5" }`.
- **Why it was necessary:** The full `npm audit` reported 10 moderate findings, all one advisory: minimatch below 11.0.1 is open to a denial of service through crafted glob patterns (GHSA-g3hv-75wg-m249). ESLint and typescript-eslint pull it in as `^10`, and no patched 10.x exists. npm's suggested fix was to downgrade ESLint to 9 and typescript-eslint to 8.36, which I rejected because it drops current tooling to fix a dev-only issue. With the override, I verified that the full audit is clean and ESLint still lints, still reports errors and still honors its ignore patterns.
- **Tradeoff accepted:** ESLint runs on a minimatch major it doesn't declare. The issue never reached production (the production audit was already clean), and it only affects tooling that reads globs from this repo's own config. Remove the override once ESLint depends on minimatch 11 itself.

### D-50 Keep only bars inside the regular session `[Phase 2]`
- **Decision:** The Yahoo mapper keeps a bar only if its start time lies inside one of `meta.tradingPeriods`' regular periods (`start <= t < end`). Bars outside a period are dropped and counted (`outsideSession`). `tradingPeriods` becomes a required field for in-scope instruments when bars exist; missing means 502. It is a correctness field under D-41's rule.
- **Why it was necessary:** The real TSLA and ^GSPC captures end the latest day with an extra bar at 16:00 ET, exactly the session end: `low = high = open = close` (the closing price) and volume 0. It is a closing-price stub, not a 15-minute trading bar. It appears only on the latest day (Nov 5 had 27 bars; every other day had 26). Left in, it would add a fake sample to that day's averages. Filtering on `tradingPeriods` removes exactly that one bar in both fixtures and nothing else.
- **Alternatives considered:** Dropping zero-volume bars (rejected: a real quiet bar can have zero volume). Dropping bars where `low == high == close` (rejected: too specific to today's shape of the quirk). Filtering in `aggregateDaily` (rejected: it is a Yahoo quirk, so it belongs in the mapper, per D-32).
- **Tradeoff accepted:** A response without `tradingPeriods` fails instead of being used. Both in-scope fixtures include it, and VFIAX, which lacks it, is rejected earlier on granularity.

### D-51 Fixture set and golden oracle `[Phase 2]`
- **Decision:**
  - **Fixtures:** captured once with `npm run capture` after the 2026-11-05 close, before midnight ET, so `currentTradingPeriod` describes the Nov 5 session (14:30 to 21:00 UTC). Both e2e clocks fit that session (18:00 inside, 21:30 after), so no synthetic session fixture was needed.
  - **What's committed:** `TSLA.json` whole (651 bars, Oct 2 to Nov 5), `GSPC.json` and `VFIAX.json` whole, `unknown-symbol.json` and a trimmed `BTC-USD.json`. BTC was cut to Nov 5 20:00 UTC through Nov 6 01:00 UTC with `scripts/trim-fixture.mjs`, which runs through `sliceFixture` and records the trim inside the file. That keeps its 8 null bars, its off-grid live bar and its metadata.
  - **Formatting:** fixtures and golden files are excluded from Prettier, so they stay byte-for-byte as captured or generated.
  - **Golden files:** `scripts/golden.py` writes `golden.after-close.json` and `golden.in-session.json`, applying the spec's rules in Python `Decimal` with no shared code. After-close: 651 bars, 650 after the session filter, 24 days (Oct 5 to Nov 5), no partial day. In-session: 638 bars (last at 12:45 ET), 24 days, partial day 2026-11-05. Only the Nov 5 row differs between them. A plain-float recomputation of Nov 5 matched both.
- **Why it was necessary:** Tests need real Yahoo shapes, and expected values must not come from the code under test.
- **Tradeoff accepted:** Fixtures are a snapshot. If Yahoo changes shape, the manual live smoke check (Phase 5) is what catches it. On Windows, `golden.py` needs `pip install tzdata` and must run without `-I`, since isolated mode hides the user site-packages where pip puts tzdata. It writes LF line endings explicitly, so output is byte-identical on every OS.

### D-52 Domain implementation details `[Phase 3]`
- **Decision:**
  - **Rejection order.** `aggregateDaily` checks each bar in a fixed order: missing or non-finite price (`nullPrice`), then non-positive price (`nonPositive`), then `low > high` (`inverted`), then bad volume (`badVolume`). A bar with several faults is counted once, under the first reason.
  - **Diagnostics are in-window only.** Bars outside the window are skipped before they're checked, so they never show up in the counts.
  - **`InstrumentInfo` has no granularity field.** The mapper rejects anything other than 15m before building it, so the domain never sees another granularity.
  - **decimal.js uses its named export** (`import { Decimal }`). Under NodeNext resolution, its type declarations load as CommonJS, so the default import types as the module object rather than the class. The named export works for both types and the ESM runtime.
  - **The domain imports types only from `@isv/shared`.** Those imports are erased at compile time, and the compiled domain's runtime imports are `decimal.js` plus its own modules.
- **How it was verified:** Tests came first, written from the spec's expected values: A1 to A10, W1 to W4, T1 and T2, R1 to R3, P1 and V1 to V5. A11 then compared `aggregateDaily` with the Python golden files and matched all 24 days in both scenarios, including the partial day, on its first run. Mutation checks confirmed that each guard can fail:
  - uppercasing before validation is caught by V4
  - day keys in UTC are caught by T1 and W4
  - naive float rounding is caught by R1
  - keeping inverted bars is caught by A4
  - keeping the first duplicate is caught by A7
  - skipping the session filter is caught by A11 (Nov 5's low average moves from 342.6944 to 342.7312)
- **Gap found and fixed:** A mutant that adds a rejected bar's volume to its day survived the first version of A1. That's the exact bug behind review issue #1. A1's rejected bar came first in the day, so the buggy code had no group to add to yet. A1 now runs with the rejected bar both before and after a usable one, and A4 checks volume as well. Both now fail against that mutant.
- **Tradeoff accepted:** A11 maps the fixture to bars by hand, session filter included, until the Yahoo mapper exists in Phase 4. Phase 4 adds the same comparison through the real mapper.

### D-53 Provider, guard, cache and service details `[Phase 4]`
- **Decision:**
  - **Mapper check order.** Granularity is checked before instrument scope. VFIAX (a mutual fund with `1d` data) therefore returns 422 `INTRADAY_UNAVAILABLE` rather than `UNSUPPORTED_INSTRUMENT`, which tells the user something more useful.
  - **Schema tolerance.** Unknown `meta` keys are ignored, since zod's default object drops them rather than rejecting. A malformed display-only field (`currency`, `currentTradingPeriod`) is treated as absent instead of failing the payload. Correctness fields (timezone, instrument type, granularity, timestamps, quote arrays, `tradingPeriods`) still fail it.
  - **`tradingPeriods` shape.** Only the list-of-lists shape seen in the real capture is accepted. Anything else returns 502.
  - **Error codes during cooldown.** While the guard is open, requests get an error matching the cause: rate limited, blocked, or (after failed probes) `ProviderUnavailable` with a `Retry-After`. Phase 5 maps these to status codes.
  - **Cancelled probe.** If the caller cancels the probe, the guard reopens with zero wait, so the next request probes again. Nothing was learned, so it shouldn't be treated as success or failure.
  - **Hard attempt timeout.** Each attempt races its own timeout. That enforces the deadline even if a provider ignores its abort signal.
  - **Cache shape.** The cache returns a result, either data or an error, together with the seconds of cache life left (`maxAgeSeconds`). It stores provider data only, and uses `Map` insertion order to evict the least recently used entry.
  - **Logging.** The service logs a warning when data-quality diagnostics are non-zero. The routine closing-price stub (`outsideSession`) is included in that log but never triggers it on its own.
- **How it was verified:**
  - The mapper ran against every captured fixture.
  - The client ran against a fake `fetch`.
  - The guard ran under fake timers: attempts start at exactly 0, 3200 and 6800 ms, and a hanging upstream ends within 8000 ms.
  - Every probe outcome in the spec table is a test case.
  - A11 was repeated through the real client, mapper, guard, cache and service, and matched the golden files in both scenarios.
  - Mutation checks: each mutant below failed at least one test. The test that caught it is in brackets.

    | Mutant | Caught by |
    | --- | --- |
    | 429 retried before the block check | H5, H5b, "does not retry a 429" |
    | No minimum attempt budget | the minimum-attempt test |
    | Requests allowed through during the probe | H5c |
    | Cache storing every failure | the four "never caches" tests |
    | Session end treated as inclusive | H9d, the client test, the real-stack golden test |

- **What the checks also found:**
  - Making a 429 retryable alone is an equivalent mutant, because the block check already runs before the retry decision. The real risk (retry first) was tested instead.
  - The probe-outcome test titles printed an object where the expected state belonged, so the table columns were reordered.
- **Tradeoff accepted:** Coalescing and the global limiter are still Should items. Until they ship, concurrent cache misses for one symbol each call Yahoo, and the per-IP limit plus the cooldown are the only protection.

### D-54 HTTP layer details `[Phase 5]`
- **Decision:**
  - **Status mapping:**

    | Status | Codes |
    | --- | --- |
    | 400 | `INVALID_SYMBOL`, `BAD_REQUEST` (keeps the framework's own 4xx status) |
    | 404 | `SYMBOL_NOT_FOUND`, `NOT_FOUND` |
    | 422 | `UNSUPPORTED_INSTRUMENT`, `INTRADAY_UNAVAILABLE` |
    | 429 | `RATE_LIMITED` |
    | 500 | `INTERNAL_ERROR` |
    | 502 | `UPSTREAM_REJECTED`, `UPSTREAM_BAD_RESPONSE`, `UPSTREAM_UNAVAILABLE` |
    | 503 | `UPSTREAM_RATE_LIMITED`, `UPSTREAM_BLOCKED`, `SERVER_BUSY` |
    | 504 | `UPSTREAM_TIMEOUT` |

    `UPSTREAM_UNAVAILABLE` becomes 503 with `Retry-After` only while the guard is cooling down after failed probes. That way, every guard rejection gets the UI's countdown.
  - **`Retry-After` is guaranteed** on every 429 and 503. When the cause gave none, it falls back to `UPSTREAM_COOLDOWN_SECONDS`.
  - **Problem body.** `type` is `about:blank`, so `title` is the HTTP reason phrase. The `detail` text never includes upstream content. `instrumentType` is an extension member on `UNSUPPORTED_INSTRUMENT`.
  - **Request IDs.** A well-formed incoming `X-Request-Id` (at most 64 characters from `A-Za-z0-9._-`) is kept. Anything else is replaced with a UUID. Fastify's built-in `requestIdHeader` is off, because it would echo any value into logs and responses.
  - **Long symbols.** `maxParamLength` is 256, so symbols of 33 to 256 characters get 400 `INVALID_SYMBOL`. **Corrected in Phase 6:** longer paths don't get 404 `NOT_FOUND` as first written here. Fastify's router rejects them with its own 414 before any route or handler runs, and the reply was plain JSON that echoed the path. A `frameworkErrors` handler now makes them problem+json `BAD_REQUEST` with status 414 (D-56).
  - **Health routes are exempt from the rate limit**, so frequent liveness checks never get throttled.
  - **`CLOCK_FIXED_AT` is refused unless `NODE_ENV=test`.** That's stricter than the spec, which only said to refuse it in production, because a fixed clock in development would silently show stale data.
  - **Config validation.** Empty variables count as unset, so a copied `.env.example` works as is. `UPSTREAM_ATTEMPT_TIMEOUT_MS` may not exceed `UPSTREAM_TOTAL_TIMEOUT_MS`.
  - **`buildApp` doesn't call `ready()`.** `listen()` and `inject()` both do that, and tests can then add probe routes for the thrown-error and schema-error cases.
  - **Running locally.** `npm start` loads `backend/.env` through Node's `--env-file-if-exists`. `npm run dev -w @isv/backend` runs `tsx watch --conditions=source`, so `@isv/shared` resolves from source without a build.
  - **Plugins:** @fastify/helmet 13, @fastify/cors 11 and @fastify/rate-limit 11, all declaring Fastify `5.x`. The full `npm audit` stays at 0.
- **How it was verified:**
  - 75 new backend tests (238 now): config, every route outcome through the real stack over fixtures, H10 framework errors, request IDs, health, security headers, CORS and H14 proxy trust.
  - The compiled server, run by hand: a bad `TRUST_PROXY` exits with code 1 and a readable message, the endpoints answer, and `SIGTERM` drains and exits 0.
  - Mutation checks, each caught:

    | Mutant | Caught by |
    | --- | --- |
    | Dropping `Retry-After` on 503 | H5, H6 |
    | `trustProxy: true` | Both H14 spoofing tests |
    | CORS open to every origin | Both CORS tests |

- **Live smoke check (2026-11-05, after the close):** `npm run smoke:live` against real Yahoo returned TSLA at 200 with 24 days. The Nov 5 row (lowAverage 342.6944, highAverage 347.1856, volume 293,795,826) is identical to `golden.after-close.json`, so the session filter drops the closing-price stub on live data too (with the stub, lowAverage would be 342.7312). The unknown symbol returned 404 `SYMBOL_NOT_FOUND`. `Cache-Control` was `public, max-age=60` for data and `max-age=30` for the 404.
- **Known exception:** While the server is closing, Fastify answers new requests with its own 503 (`return503OnClosing`), which bypasses the problem+json handlers. It only happens during shutdown, so I left it.
- **Tradeoff accepted:** Helmet joins CSP directives without a space (`default-src 'none';frame-ancestors 'none'`). That's valid CSP, and the test asserts the real output. `SERVER_BUSY` stays unused until the global limiter ships.

### D-56 Frontend details `[Phase 6]`
- **Decision:**
  - **Design.** A dark landing page with a fire-and-light theme: a headline hero with the search form, a glowing line along the horizon and rising embers. Below it are the results: header, chart and table. The page has only the app's own elements, and it shows no market hours or open/closed status. The UI can't know market hours (D-36), so "Still trading" appears only where `X-Partial-Day` names a day.
  - **"Held" means no request.** Searching a symbol during its own countdown shows that countdown again without a request. When the countdown ends, Retry becomes available but never fires by itself, since HTTP errors are never retried automatically.
  - **Messages from codes only.** Problem bodies have no hint field, so the 404 message adds a fixed hint ("Check the ticker...") rather than any server text. `instrumentType` is shown only when it matches `^[A-Z_]{1,32}$`. Known types get plain names ("mutual fund"), and unknown ones are lower-cased.
  - **The timeout is detected by error name.** The spec's sketch used `instanceof DOMException`, which failed in tests because the DOMException came from another realm. A browser extension or iframe can cause the same thing in real use.
  - **Empty `X-` headers read as absent**, so an empty `X-Currency` never draws an empty unit.
  - **Dates and numbers.** `day` strings are split, never parsed. The weekday comes from arithmetic (Sakamoto's method), and ESLint bans `new Date` and `Date.parse` in `frontend/src`. Prices are padded to 4 decimals for alignment without changing their value. The spread is computed in whole ten-thousandths so float subtraction can't round the wrong way.
  - **Table.** The latest 8 days show first, with a button for the rest.
  - **Motion.** All JavaScript motion (embers, the count-up) is off under `prefers-reduced-motion`, and CSS animations are cut to one frame. The embers pause while the hero is off screen.
  - **Fonts** are self-hosted through `@fontsource`, so the page makes no third-party requests.
  - **Test tooling.** jsdom is held at 29, because 30 and later need Node 24.15 or newer and `.nvmrc` pins 24.14.1. It's a root dev dependency, next to Vitest, because Vitest loads it from wherever Vitest itself is installed. At first it was declared in `frontend/` only, so the tests were really running on a stale jsdom 31 left at the root; CI failed once that copy was removed from the lockfile. MSW 3 renamed `onUnhandledRequest` to `onUnhandledFrame`.
  - **`npm run dev`** now starts the API and the web app together through `scripts/dev.mjs`, with no extra dependency. On Linux and macOS each task runs in its own process group, so stopping it also stops vite and tsx.
  - **Two backend fixes found while running the app:** router rejections (a parameter over 256 characters, a malformed encoding) now get problem+json instead of Fastify's plain JSON echoing the path, and `maxParamLength` moved under `routerOptions` to stop the FSTDEP022 startup warning.
- **How it was verified:**
  - 81 frontend tests (F1 to F5, F7 to F9, the client and formatting) and 3 new backend tests. Every package passes under UTC, Kiritimati and Los Angeles, and every Phase 6 commit passes lint, typecheck, format, tests and build on its own.
  - Mutation checks, each caught:

    | Mutant | Caught by |
    | --- | --- |
    | A countdown that blocks every symbol | F8 |
    | Timeouts auto-retried, or network retried twice | F4 |
    | Re-searching a held symbol sends a request | F8 |
    | No 5 s fallback for a missing `Retry-After` | F3 |
    | The client ignores the caller's abort signal | F2, client test |
    | A 400 shown as a panel instead of a field error | F3 |
    | `day` formatted through `new Date(day)` | F1 |
    | The badge on the last day instead of `X-Partial-Day` | F5 |
    | Float subtraction for the spread | Format test |
    | Fastify's default `maxParamLength` | 256-character test |
    | No `frameworkErrors` handler | Both router-error tests |

  - The built app was served with a fake API and checked in Chromium: axe found 0 violations in the results, countdown, 422 and 360 px mobile states, and there's no horizontal scroll at 360 px. Lighthouse scored 100 for accessibility and 100 for best practices on the landing page.
- **Tradeoff accepted:** The landing hero takes the first screen, so results begin below the fold. The app scrolls to them after each search, and the nav keeps the current symbol one click away.

### D-57 Real-stack e2e details `[Phase 7]`
- **Decision:**
  - **Session check, no synthetic fixture.** Global setup reads the TSLA capture's `currentTradingPeriod.regular` (14:30 to 21:00 UTC on 2026-11-05). It fails the run unless 18:00 UTC is inside the session and 21:30 UTC is after it. Both clocks fit, so `scripts/makeSessionFixture.mjs` wasn't needed and the capture is used as is.
  - **Fake Yahoo uses the same slicing code as A11.** `e2e/fakeYahoo.mjs` imports `backend/test/support/sliceFixture.ts` directly, since Node 24 strips the types. At startup it checks every fixture (aligned arrays, and a mid-fixture cut keeps exactly the earlier bars). On every request it checks that nothing outside `[period1, period2)` is served, and it records `period1`, `period2`, the bar count and the last bar. `GET /__requests` returns that log for E1c.
  - **Config lives in `e2e/`.** The spec showed `playwright.config.ts` at the root. It moved to `e2e/` with its own `tsconfig.json`, because type-aware linting needs a tsconfig that covers it. The root `typecheck` now includes `e2e/`.
  - **One run per clock.** `npm run test:e2e` runs `e2e/run.mjs`, which runs Playwright twice in sequence with `E2E_SCENARIO` set to `after-close` and then `in-session`. Before each run it fails with a clear message if port 4010, 3001 or 4173 is in use, and after each run it waits for the ports to free up. Every server uses `reuseExistingServer: false`.
  - **Compiled code under test.** The API server step builds `@isv/shared` and then `@isv/backend` before `npm start`, so the API runs from `dist` exactly as in production. The UI is the built bundle served by `vite preview`, with its `/api` proxy.
  - **127.0.0.1 between servers.** The API listens on 127.0.0.1, and `YAHOO_BASE_URL` points at 127.0.0.1, so no hop depends on how `localhost` resolves.
  - **Two browser timezones.** Every test runs in Pacific/Honolulu and Asia/Tokyo. The browser asks for reduced motion, so the tests see the final page rather than an entrance animation.
  - **Oracles.** Each test compares the API's JSON to the golden file exactly, checks the `X-` headers, and compares every table row (after "Show all") to the golden rows. A small test-side formatter produces the expected row text, using `Date` in UTC as an independent check; the app never builds a Date.
  - **Playwright 1.63.0**, pinned in the lockfile. CI installs only Chromium, and on failure it uploads the HTML report and traces.
- **How it was verified:**
  - All 8 tests (E1, E2, E1b and E1c in both timezones) pass, and the suite passed twice back to back without cleanup. E1c's log shows `period2` equal to the in-session clock and the last served bar before it.
  - Mutation checks, each caught:

    | Mutant | Caught by |
    | --- | --- |
    | Fake Yahoo ignores `period2` | E1b, E1c |
    | Both runs use the after-close clock (one shared backend) | E1b, E1c |
    | The UI formats `day` with `new Date(day)` | E1 and E1b, Honolulu only |
    | An in-session clock outside the session | Global setup, before any test |

  - A busy port 3001 stops the run at once with the explanatory message.
- **Tradeoff accepted:** Each scenario builds the backend and the frontend again, so a full e2e run takes about a minute locally. That buys a fresh backend with the right clock for each scenario.

---

## Assumptions (to verify during implementation)

Each assumption lists what I'm assuming, why I had to assume it, and the cost if it's wrong. Most are verified in step 1 by capturing live responses as fixtures. When one is verified or disproved, I'll update its entry here.

### A-01 Yahoo requires a browser-like User-Agent
- **Assumption:** Requests without a browser-like `User-Agent` are rejected with 429 or 403.
- **Why it was necessary:** The brief's own curl sets one, and the API is undocumented.
- **Tradeoff accepted:** If it isn't required, we send one anyway at no cost. The value is configurable.
- **Result from the fixture capture (2026-11-05):** **Disproved for now.** A TSLA request with no User-Agent returned 200 with the same 651 bars. The client still sends one, because it costs nothing and Yahoo has blocked bare clients before. The evidence is kept locally in `fixtures-raw/`, not committed.

### A-02 Yahoo's v8 chart endpoint works without a cookie or crumb
- **Assumption:** The chart endpoint needs no session cookie or crumb token.
- **Why it was necessary:** The brief's curl works without one.
- **Tradeoff accepted:** If that changes, only the Yahoo client needs updating. The rest of the app is isolated from it.
- **Result from the fixture capture (2026-11-05):** **Confirmed.** Every request succeeded with no cookie or crumb.

### A-03 Unknown symbols return 404 with a "Not Found" error code
- **Assumption:** Unknown symbols return 404 with `chart.error.code` "Not Found", sometimes as an error inside a 200 response.
- **Why it was necessary:** Classification depends on it.
- **Tradeoff accepted:** If wrong, unknown symbols surface as 502 until the mapping is adjusted.
- **Result from the fixture capture (2026-11-05):** **Confirmed.** The unknown symbol returned HTTP 404 with `chart.error.code` "Not Found" and description "No data found, symbol may be delisted" (fixture `unknown-symbol.json`). No error inside an HTTP 200 was seen, so the H2 test stays synthetic.

### A-04 Null array values mean bars with no trades
- **Assumption:** `null` in the price and volume arrays means a bar with no trades or a halt.
- **Why it was necessary:** It underpins the usable-bar rule (D-14).
- **Tradeoff accepted:** If nulls mean something else, the omitted bars may need different handling.
- **Result from the fixture capture (2026-11-05):** **Confirmed.** In BTC-USD, all 8 null bars are null in every field at once (empty bars). TSLA and ^GSPC had no nulls in the window.

### A-05 The last bar during market hours may be a live tick **Revised** `[R2-#4]`
- **v1:** Assumed true, and a filtering rule was built on it (D-16 v1).
- **v2 (current):** Unverified, so no rule depends on it. It is settled by capturing a fixture during market hours.
  - **If a live tick appears:** add the narrowest rule that matches the evidence, tested with that fixture.
  - **If not:** this assumption is closed as disproved.
- **Why it changed:** A rule built on an unverified assumption could discard real data. "Harmless dead code" was wrong: the rule had a cost if the assumption was false.
- **Tradeoff accepted:** Until verified, a live tick, if it exists, could briefly double-count the current day.
- **Result from the fixture capture (2026-11-05):** **Partly answered.** No off-grid bar appeared in TSLA or ^GSPC after the close. BTC-USD, which trades around the clock, does end with an off-grid bar whose timestamp equals `meta.regularMarketTime` (a live, still-forming bar), but BTC is out of scope. A capture during US market hours is still needed to see whether equities do the same. A different quirk turned up instead: the closing-price stub bar (D-50).

### A-06 `instrumentType` and `dataGranularity` are present **Revised** `[R2-#5]`
- **v1:** `instrumentType`, `dataGranularity` and `currentTradingPeriod` are all present; a missing one fails with 502.
- **v2 (current):** Only `instrumentType` and `dataGranularity` are assumed present, since scope (D-06) and the granularity check (D-11) depend on them. `currentTradingPeriod` is optional (D-41).
- **Why it changed:** Requiring a field that only feeds a header made valid responses fail.
- **Tradeoff accepted:** If a correctness field is missing, the request fails with 502 instead of guessing.
- **Result from the fixture capture (2026-11-05):** **Confirmed.** `instrumentType`, `dataGranularity`, `exchangeTimezoneName`, `currency`, `currentTradingPeriod` and `tradingPeriods` are all present for TSLA (EQUITY) and ^GSPC (INDEX). VFIAX (MUTUALFUND) reports `dataGranularity` "1d" and has no `tradingPeriods`, which matches the planned 422 `INTRADAY_UNAVAILABLE`.

### A-07 Yahoo's rate limit applies per server IP
- **Assumption:** Yahoo's rate limit is keyed to the calling server's IP address.
- **Why it was necessary:** Justifies the global cooldown and limiter (D-28, D-31).
- **Tradeoff accepted:** If it's looser, we're more conservative than needed.
- **Result from the fixture capture (2026-11-05):** **Not observed.** No 429 came back during capture, so how Yahoo keys its rate limit couldn't be confirmed. The global cooldown stays, since it's the safe choice either way, and `Retry-After` handling is tested with synthetic responses only.

### A-08 The app runs locally and is reviewed locally
- **Assumption:** Reviewers run the app on their own machine. No cloud deployment is expected.
- **Why it was necessary:** The brief says "self-hosted" and asks for local run instructions.
- **Tradeoff accepted:** HTTPS, CD and real proxy configuration are documented, not built.

### A-09 Reviewers value correctness over breadth
- **Assumption:** Reviewers would rather see a narrower, correct app than a broader, less reliable one.
- **Why it was necessary:** It justifies the instrument scope limit and the Must/Should cuts.
- **Tradeoff accepted:** The app supports fewer symbol types than Yahoo offers.



