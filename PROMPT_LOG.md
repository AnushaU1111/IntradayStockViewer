# PROMPT_LOG.md

How I used AI on this assessment: what I asked, why, what I kept and what I changed or rejected.

Rules for this log:

- Entries record real exchanges only, in the order they happened.
- Prompts are lightly edited for spelling, grammar and tone; their meaning and scope are unchanged. Long prompts, such as pasted review lists, are summarized. Nothing is invented.
- "Changed / rejected" is where AI output was wrong, outdated or not what I wanted. Those entries matter most.

Tool: Claude (Anthropic), used for planning, review and code generation.

---

## Planning

### 1. Requirements document from the brief

- **Prompt:** "This is my take-home assignment for the Prometheus team. Don't write any code yet. Review everything and prepare a thorough requirements document, approaching the problem with an open mind and considering everything a senior software engineer would." Followed by my ten quality pillars and: "For this task, focus especially on clean structure, input validation, error handling and a few meaningful tests, with attention to edge cases."
- **Why:** Plan before coding, and surface ambiguity in the brief first.
- **Kept:**
  - The ambiguity table. The most important finding: the brief's sample curl has no `range`, so it returns one day, not one month.
  - Grouping by the exchange's timezone, and the DST change on 2026-11-01 inside the window.
  - The provider interface around Yahoo.
  - The bare-array response contract.
- **Changed / rejected:** Much of the first draft was revised in the review rounds below.

### 2. Stack choice

- **Prompt:** "I'd like to use the recommended Node.js and TypeScript stack for the API. What's your recommendation?"
- **Why:** The brief allows .NET or Node/TypeScript, and I wanted the tradeoff stated before committing.
- **Kept:** Node.js + TypeScript, with one language and shared validation across the API and UI. Also the advice to turn on `noUncheckedIndexedAccess` and avoid naive `Math.round` rounding.
- **Changed / rejected:** Nothing.

### 3. Review round 1 (21 issues)

- **Prompt:** "Here are the issues I found. Don't be biased: consider each one seriously and propose solutions for the most critical," with my list of 21 prioritized issues. Follow-up: "Revise the plan with the critical and high-priority fixes first. I'll roll out the smaller fixes depending on time."
- **Why:** Stress-test the spec before coding.
- **Kept:**
  - One usable-bar rule for prices and volume.
  - A fetch window defined by explicit `period1` and `period2`.
  - IANA-only timezone handling, with tests designed to fail under UTC or fixed-offset grouping.
  - decimal.js rounding, a single request deadline and backend-owned retries.
  - A full upstream error classification.
- **Changed / rejected:** The AI raised instrument scope (crypto, forex, futures) from High to Critical, and I accepted that. I had it apply the critical and high fixes first and leave the medium ones for later.

### 4. DECISIONS.md

- **Prompt:** "Create a `DECISIONS.md` covering the decisions and assumptions made so far, with three parts for each: Decision, Why it was necessary and Tradeoff accepted. If a decision changed, include both versions."
- **Why:** Record assumptions instead of waiting on confirmation, and keep the reasoning reviewable.
- **Kept:** The format, with v1 and v2 versions shown for every revised decision.
- **Changed / rejected:** Nothing.

### 5. Review round 2 and verification of the AI's fixes

- **Prompt:** "Check the plan rigorously against these issues. Leave out anything unnecessary, but keep an open mind," with 10 pre-coding issues. I then sent a verification review of the AI's proposed fixes.
- **Why:** Check the fixes themselves, not just the original issues.
- **Kept:** A fixed test clock for end-to-end tests, removal of speculative bar-alignment rules, optional display-only metadata, cancelled vs timeout vs network errors, aggregation returning diagnostics instead of logging, and caching provider data rather than finished responses.
- **Changed / rejected:**
  - **Rounding test was wrong.** The AI's first test pair (1.0001, 1.0002) does not fail under float arithmetic. Running it in Node showed float already gives 1.0002. It was replaced with verified failing pairs, and the test now asserts that naive rounding fails.
  - **Proxy advice was outdated.** The AI recommended `TRUST_PROXY=1` (hop count). A Fastify advisory (GHSA-3m5p-2c4r-xxw2) showed that form trusts spoofed headers, and Fastify 5.12.1 disabled it. It was replaced with IP/CIDR-only trust.
  - **Retry-After cap rejected.** The AI proposed clamping Yahoo's `Retry-After` to 300 s. I rejected it: honor the delay exactly, then send a single probe.
  - **Missing quote arrays could have become `[]`.** Corrected: timestamps without quote data are malformed and return 502.
  - **Error caching was too broad.** The AI's wording allowed caching "a domain error". Restricted to 404 and 422 only.

### 6. Review round 3

- **Prompt:** My list of 7 remaining issues: Fastify version floor, incomplete half-open cooldown, session start missing, in-session e2e showing future bars, Must/Should inconsistencies, unspecified 429/503 UI states, stale tracker text.
- **Why:** Close gaps before implementation.
- **Kept:** A full cooldown state table covering every probe outcome, `sessionStart` and `sessionEnd`, a fake Yahoo server that honors `period2`, and `Retry-After` on every 429 and 503.
- **Changed / rejected:** The AI checked the Fastify advisory and noted it is low severity (3.7). The floor was raised to 5.12.6 anyway, since the bump costs nothing.

### 7. Review round 4

- **Prompt:** My list of 7 issues: one backend clock for two e2e scenarios, Fastify floor, the countdown blocking other symbols, timestamp values unchecked, the loading state disabling cancellation, label fallbacks.
- **Why:** Find contradictions left in the plan.
- **Kept:** Two Playwright runs with separate backend clocks and `reuseExistingServer: false`, Fastify at least 5.12.8 (CVE-2026-120216) with `handlerTimeout` left at 0, a countdown scoped to the failed symbol, safe-integer timestamp validation, and a form that stays usable while loading.
- **Changed / rejected:** The AI's own e2e config from round 3 started a single backend with a single clock, which contradicted its two-clock tests. Fixed here.

### 8. Implementation plan and review round 5

- **Prompt:** "The plan looks good. Lay out an implementation plan," then my review of that plan.
- **Why:** Turn the spec into ordered, gated phases.
- **Kept:** Eight Must phases, each with commits, test IDs, an AI-output watchlist and a gate, then the Should tier.
- **Changed / rejected:**
  - **Golden-file test inputs.** The AI's plan compared the full fixture against the in-session golden file, which would fail even with correct code. Fixed with a shared `sliceFixture` helper.
  - **Parse errors retried as network failures.** The AI's earlier client code would have treated a body-parse failure as a network error and retried it. Network errors are now caught around `fetch()` only.
  - **Gates and fixtures:** Vitest fails on an empty suite, so each workspace gets a real smoke test. Phase gates no longer depend on live Yahoo. Fixture headers are allowlisted, and the plan submits once, after the Should tier.

---

## Implementation

### 9. Phase 1: scaffold and CI

- **Back and forth:**
  1. **Request:** "Start with a framework for phase 1, before I go in and test it"
     - **Response:** Built the workspace, configs, smoke tests and CI. It first reached for TypeScript 7, then checked typescript-eslint's supported range and pinned 6.0.3 instead.
- **Why:** Build the workspace, strict TypeScript, lint, tests and CI before any feature code.
- **Kept:**
  - npm workspaces (`packages/shared`, `backend`, `frontend`).
  - A strict TS base config, ESLint `strictTypeChecked`, Prettier and Vitest with one real smoke test per workspace.
  - A GitHub Actions workflow with lint, typecheck, production audit, build and tests across three host timezones.
  - A guard test that fails if `TZ` does not reach Node.
- **Changed / rejected:**
  - **TypeScript 7 not used.** The AI first looked at TypeScript 7.0.2, then checked typescript-eslint 8.72.1's peer range (`<6.1.0`) and pinned `~6.0.3` instead (DECISIONS D-46).
  - **First frontend test config failed.** It set only client resolve conditions, so `@isv/shared` didn't resolve in Vitest's default Node environment. Fixed by also setting the ssr conditions.
  - **Timezone guard verified.** Checked that it fails when `TZ` is set but not applied.

### 10. Phase 2: fixtures and golden oracle

- **Back and forth:**
  1. **Request:** "Start Phase 2. Save real Yahoo responses as test fixtures, test each assumption about Yahoo against them and compute the expected results without using the app’s own code."
     - **Response:** Wrote `scripts/capture.mjs` and tested it against a local fake server. Its sandboxes can't reach Yahoo, so it asked me to run the capture on my laptop.
  2. **Request:** Ran the capture locally and shared the results.
     - **Response:** Checked every Yahoo assumption against the captured data and found the 16:00 closing-price stub bar. It compared three ways to drop it and recommended filtering by `tradingPeriods` (D-50).
  3. **Request:** Reported that `scripts/golden.py` failed on Windows.
     - **Response:** Found that Python's `-I` flag hid the `tzdata` package installed in my user site-packages. It removed the flag and made the script write LF line endings.
- **Why:** Capture real Yahoo responses, check every Yahoo assumption against them, and build expected values independently of the app.
- **Kept:**
  - `scripts/capture.mjs`, which I ran on my laptop because the AI's sandboxes can't reach Yahoo. Before I ran it, it was tested against a local fake server: cookies are stripped from the committed copies, and a plain-text 429 is stored verbatim.
  - `sliceFixture` and its tests, `scripts/trim-fixture.mjs` (used to trim BTC-USD from 652 KB to 21 bars), and `scripts/golden.py` in Python `Decimal`.
  - The assumption results recorded in DECISIONS: User-Agent not currently required, 404 shape confirmed, indices do report volume, `currentTradingPeriod` matches both e2e clocks.
- **Changed / rejected:**
  - **New rule from the data (D-50).** Analyzing the capture showed Yahoo appends a closing-price stub bar at 16:00 ET on the latest day (`low = high = close`, volume 0). The spec had no rule for it, and it would have skewed that day's averages. The new rule keeps only bars inside `meta.tradingPeriods`. Zero-volume and flat-bar filters were rejected as too blunt.
  - **Lint caught the AI's first `sliceFixture`.** It used type assertions that the strict lint rules rejected. It was rewritten with an index predicate instead of assertions.
  - **Generated data excluded from Prettier.** Prettier flagged the captured fixtures for formatting. They were excluded, so fixtures stay byte-for-byte as captured.

### 11. Phase 3: shared package and domain, test-first

- **Back and forth:**
  1. **Request:** "Complete Phase 3. Build every business rule as a pure function, writing the tests first from the values the spec expects."
     - **Response:** Wrote the tests first from the spec's expected values, then the shared package and the domain until they passed.
  2. **Request:** Asked for evidence that the tests can actually fail.
     - **Response:** Ran mutation checks. One mutant survived and exposed A1 passing only because of bar order, so A1 was rewritten to test both orders.
- **Why:** Implement every business rule as pure functions, with failing tests written first from the spec's expected values.
- **Kept:**
  - `parseSymbol` (ASCII check before uppercasing), the error codes, the response type, the header names and the path builder in `@isv/shared`.
  - `mean4` (decimal.js, rounded half up), `dayKey` (IANA via `Intl`), `tradingWindow` and `minusOneMonth`, `partialDay`, the day strategies, and `aggregateDaily` returning `{ days, diagnostics }`.
  - 99 tests (36 shared, 63 backend). They pass in UTC, Kiritimati, Los Angeles and Sydney.
  - A11 matched the independent Python golden files on all 24 days in both scenarios on its first run.
- **Changed / rejected:**
  - **A1 couldn't fail.** I had the AI run mutation checks, and one mutant survived: it adds a rejected bar's volume to its day, which is the review-round-1 bug. The original A1 passed by accident because of bar order. A1 now tests both orders, and A4 checks volume too.
  - **decimal.js default import.** The AI's first version used it, which typechecks as the module rather than the class under NodeNext. It was switched to the named export.
  - **Type casts.** Lint rejected `as number` casts in `aggregateDaily` and a generic JSON reader in the golden test. The bar check was restructured to return the usable values, so no casts are needed.

### 12. Phase 4: provider, guard, cache and service

- **Back and forth:**
  1. **Request:** "Please complete Phase 4. Build the layers between the domain and the HTTP API: the Yahoo schema, mapper and client, the deadline, retries and cooldown, the provider-data cache and the service."
     - **Response:** Noted that my local checkout needed `git fetch` to see the new branch, then built the provider, guard, cache and service.
  2. **Request:** Asked for the same mutation checks as Phase 3.
     - **Response:** All but one mutant were caught. It explained why the survivor was equivalent to the original code and tested the real risk instead.
- **Why:** Build everything between the domain and HTTP: the Yahoo schema, mapper and client; the deadline, retries and cooldown; the provider-data cache; and the service.
- **Kept:**
  - The zod schema and mapper (including the D-50 session filter), and the client with strict Retry-After parsing.
  - The upstream guard: one 8 s deadline, retries only for 5xx, network errors and timeouts, and a closed/open/half-open cooldown with a single probe.
  - The LRU cache storing provider data, 404s and 422s only, and the service that recomputes the window and partial day on every request.
  - 103 new backend tests (166 in the backend now).
  - A11 repeated through the real stack, matching the Python oracle in both scenarios.
- **Changed / rejected:**
  - **Mutation results.** One mutant (making a 429 retryable) survived because it was equivalent: the block check already runs before the retry decision. The AI explained why and tested the real risk instead, retrying before the block check, which the tests caught.
  - **Probe test titles.** They printed the outcome object instead of the expected state, so the table columns were reordered.
  - **Lint fixes.** Lint flagged non-null-style casts, an empty-function placeholder, a stringified URL in a test and an unbound method reference. Each was fixed with a type guard or a restructure, not a suppression.
  - **Branch.** The branch was created on GitHub, and my local checkout needed `git fetch` before committing.

### 13. Phase 6: frontend

- **Back and forth:**
  1. **Request:** "For the frontend, I want a design with real taste: professional, but also interesting and dynamic."
     - **Response:** Proposed a design direction and a first mockup: a light "chart paper" theme with a capsule chart.
  2. **Request:** "Show me the mockup as an image."
     - **Response:** Rendered the mockup as an image.
  3. **Request:** "Explain that tradeoff in detail."
     - **Response:** Compared Recharts with a hand-built SVG chart: bundle size, the custom marks the design needed, accessibility and test effort.
  4. **Request:** "The custom SVG chart is the right call, but the design still feels dull and not yet tasteful."
     - **Response:** Reworked the design until I approved a dark landing page with the motion I wanted.
  5. **Request:** Shared a screenshot of the PR's CI, with all three test jobs failing.
     - **Response:** Reproduced it on Node 24.14.1: jsdom was installed in `frontend/` while Vitest loads it from the root. It moved jsdom to the root.
- **Why:** Design the UI from mockups first, then build it on the approved design: every state in spec 5.3, the D-40 client, the custom chart and tests F1 to F5 and F7 to F9.
- **Kept:**
  - A dark landing page with a fire-and-light theme. The hero's line draws itself and traces the searched symbol's average highs, and embers rise behind it. The page has only the app's own elements.
  - `api/client.ts` with the D-40 classification, the retry policy (network only, once) and per-symbol countdowns, each in its own commit, so every commit builds and passes on its own.
  - A hand-built SVG chart with one low-to-high capsule per day, axis tags, a crosshair and keyboard navigation (D-55).
  - 81 frontend tests. axe found no violations in four states, and Lighthouse scored 100 for accessibility.
- **Changed / rejected:**
  - **Recharts replaced.** The AI laid out the tradeoff between Recharts and hand-built SVG, and I chose SVG (D-55).
  - **Market hours dropped.** The AI's own mockups showed "Market open, closes 4:00 PM ET" in the nav. The build leaves it out, since the UI can't know market hours (D-36). "Still trading" comes only from `X-Partial-Day`.
  - **Spec sketch didn't survive the tests.** The timeout check `instanceof DOMException` failed under jsdom because the error came from another realm. It now checks the error's name.
  - **Dependency versions.** jsdom 31 needs Node 24.15, newer than `.nvmrc`, so it's held at 29. The AI first declared it in `frontend/` only, while Vitest loads it from the root, so the tests were really running on a stale jsdom 31. CI caught it once that copy left the lockfile, and jsdom moved to the root. MSW 3 renamed the option the AI first used.
  - **Bugs caught by running the build.**
    - Screenshots showed the page didn't scroll to the results after a search, because the scroll ran before the results rendered.
    - The new dev script left vite and tsx running on Linux after Ctrl+C.
    - Running the API showed a Fastify deprecation warning, and checking it found that over-long symbols got Fastify's raw 414 JSON echoing the path. DECISIONS D-54 had said 404. All three are fixed. The backend fix has new tests; the other two were checked by rerunning the build and the dev script.
  - **A tooling slip.** The AI ran Prettier from inside `backend/`, where the root `.prettierignore` doesn't apply, and it reformatted the committed Yahoo fixtures. The AI saw it in the diff and restored them before committing.
  - **Mutation checks.** Eleven mutants (listed in D-56) were all caught.

### 14. Phase 7: real-stack e2e

- **Back and forth:**
  1. **Request:** "Please complete Phase 7. Test the real stack, from the built frontend to the compiled backend, under the two fixed clocks against a fake Yahoo server."
     - **Response:** Built the session check, the fake Yahoo server, the Playwright scenarios and the CI job, ran all 8 tests and the mutation checks on Linux, and wrote the files into my repo with commit commands.
  2. **Request:** Ran the suite on Windows and shared the output: all 8 tests passed, but Node printed a DEP0190 warning.
     - **Response:** Traced it to `e2e/run.mjs` and `scripts/dev.mjs` passing arguments with `shell: true` on Windows, and changed both to spawn a single command string.
  3. **Request:** Shared the rerun: all 8 tests passed with no warning.
     - **Response:** Gave me the commit commands.
- **Why:** Prove that the built UI and the compiled API work together under the two fixed clocks, with a fake Yahoo server and no real Yahoo call.
- **Kept:**
  - The global-setup session check, the fake Yahoo server built on `sliceFixture` with a request log, and `e2e/run.mjs` running both clock scenarios in sequence with port checks.
  - E1, E2, E1b and E1c in Honolulu and Tokyo, each compared with the Python golden files, plus a CI job.
- **Changed / rejected:**
  - **No synthetic fixture.** The plan allowed one if the capture's session didn't fit the clocks. The session check showed it fits, so the capture is used unchanged.
  - **Config moved to `e2e/`.** It moved out of the repo root, which the spec showed, so type-aware lint covers it (DECISIONS D-57).
  - **A first assertion that couldn't work.** The AI's first E1 looked for the axis title with `getByText`, which doesn't match SVG text in the chart. It now queries the chart's `text` elements directly.
  - **Claude can't edit CI files.** The tools that write into my repo can't change `.github/workflows/`, so the AI put the new `ci.yml` in `Claude outputs/` for me to copy.
  - **A Windows-only warning.** My first run on Windows printed Node's DEP0190 warning, because `e2e/run.mjs` (and `scripts/dev.mjs` from Phase 6) passed an argument list together with `shell: true`. On Windows both now spawn a single command string.
  - **Mutation checks.** All four mutants (listed in D-57) were caught. Parsing `day` with `Date` failed only in Honolulu, which shows why the two browser timezones matter.


