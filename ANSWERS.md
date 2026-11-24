# Answers

## 1. What was your approach (thought process) to tackling this project?

**Understand the problem before writing code.** I started from a development plan and
compared it line by line with the brief, separating what the brief states (order split,
configurable quantity precision, $100 default price overridden by partner prices,
Monday–Friday execution, history, BUY/SELL, response times in the console, no data after
restart) from what it leaves open. The open points became explicit decisions, recorded in
section 2, before any code was written. The two that mattered most were:

- **When an order executes:** "markets are open Monday through Friday" says nothing about
  time zone, hours or cut-off. I chose New York, 09:30–16:00: before the open → today's
  open; during market hours → immediately; at/after close → next weekday's open;
  weekends → Monday's open.
- **Where rounding differences go:** amounts per stock are rounded down to cents and the
  last stock takes the remainder, so the lines always add up exactly to the total; share
  quantities are rounded down to the configured precision, and the unspent cash is
  reported (`residualAmount`) rather than lost.

**Design around the money.** All amounts, percentages, prices and quantities use exact
decimal arithmetic (`decimal.js`) and travel through the API as decimal strings, never as
JavaScript floats. Every rounding mode is explicit.

**Layered structure, with the parts most likely to change behind interfaces.** Thin
controllers; an `OrderService` for the use cases; a pure `OrderCalculator` with no I/O;
`MarketScheduler`, `OrderRepository` and `IdempotencyStore` as interfaces with POC
implementations; the clock, id generator and logger injected into `createApp()`. This
keeps the maths trivially testable, lets tests fix the time, and means a database, a real
exchange calendar or a shared cache can replace the POC versions without touching the
business logic.

**Build in small, verified stages.** Setup → validation → calculation → scheduler →
storage → API → docs, each with its own tests and commit, and build, lint, type-check and
tests run before moving on. I then ran the real server, called every endpoint, and checked
a fresh clone from GitHub the way a reviewer would. Because the brief stresses
performance, I also load-tested the compiled server (`npm run perf`) and documented the
results in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

**Then harden it like a production service.** Because the brief asks for production-grade
quality, I reviewed the result as if it were going live and added: API-key authentication
with per-partner isolation, rate limiting, idempotency keys, security headers, audit
events, health probes with graceful shutdown, process-level failure handling, actionable
error messages, OpenAPI contract tests, a Docker image and a CI pipeline with security
scanning. Each review round found real defects (section 3), which were fixed with tests.

## 2. What assumptions did you make?

**Orders and calculation**

- `totalAmount` is a **value** in USD with up to 2 decimal places. **USD is the only
  currency**, because the fixed $100 price is a USD price.
- **Allocations** are percentages that must be positive and add up to **exactly 100**.
  Other totals are rejected, not rescaled: silently changing a model portfolio's weights is
  riskier than asking the partner to fix the request.
- **Duplicate symbols** are rejected (case-insensitive), not merged.
- A **partner price**, when sent, must be valid; an invalid one is rejected, never replaced
  by the default. **Unknown fields are rejected**, so a typo such as `markePrice` cannot
  silently fall back to $100.
- **SELL** uses the same value-based split as BUY. Holdings are not part of the input, so
  I do not check whether the user owns the shares.
- **Quantity precision** is configurable from 0 to 10 decimal places (default 3); money
  precision is fixed at cents. The stored order records the precision used.
- An allocation **too small to buy the smallest fraction** gets quantity 0, its amount as
  residual cash, and a warning on the order.
- Decimal values may be sent as JSON numbers, but strings are preferred and documented.
- Sanity limits (not business rules): total ≤ USD 1bn, ≤ 100 stocks per portfolio,
  page size ≤ 100.

**Execution time**

- The exchange is **New York (America/New_York), 09:30–16:00, Monday–Friday**
  (configurable), with daylight saving handled.
- **"Immediately"** means at the request time. This service calculates and schedules
  orders; it does not send them to a broker, so every order's status is `SCHEDULED`.
- **Public holidays are not handled**: the brief only says Monday–Friday, so an order
  placed before Thanksgiving would still be scheduled for that day. This is documented,
  and the scheduler sits behind an interface so a real exchange calendar can replace it.

**History, storage and platform**

- History is **per process and in memory**, newest first, with limit/offset paging, and is
  lost on restart, as the brief requires. Rate-limit counters and idempotency records are
  in memory for the same reason.
- **Clients are partner servers, not browsers**: no CORS, and authentication by API key
  is acceptable for a POC. Each partner sees only its own orders; with no keys configured
  (local development only) everything runs as one `anonymous` partner.
- The `Idempotency-Key` header is **optional**; only successful responses are stored for
  replay, so a corrected request can reuse its key.

## 3. What challenges did you face when creating your solution?

- **Rounding in two places.** Rounding cents per stock and rounding shares per stock each
  create small differences. The challenge was keeping the totals always consistent (lines
  sum exactly to the total) while never letting money disappear. Property-style tests
  check the invariants: lines add up to the total, value never exceeds the amount,
  residual is never negative.
- **An ambiguous schedule across time zones.** A request made on Saturday in UTC can still
  be Friday evening in New York, and the Monday open moves between −05:00 and −04:00 with
  daylight saving. I used Luxon and tested both DST transitions, the exact open/close
  boundaries and UTC/New York date mismatches with a fixed clock.
- **Avoiding silent wrong answers.** Many inputs "work" but produce wrong results: a
  misspelt field, a float like `0.1 + 0.2`, an invalid partner price. Strict validation
  that reports every problem at once, with messages that say how to fix it, was a
  deliberate trade-off against being lenient.
- **Defects found by testing and review** — each now has a regression test:
  - On error responses the logged route lost its `/api/v1/orders` prefix, because Express
    resets `req.baseUrl` when a request leaves a router.
  - A corrupt gzip/brotli request body returned **500** instead of 400, because the JSON
    parser reports it in a different error shape from the one I first handled.
  - If the port was already in use, the server logged "listening" and **exited with code
    0**, which an orchestrator reads as success. It now logs a fatal error and exits with 1.
  - There was no handling for unhandled promise rejections or uncaught exceptions; they
    are now logged as structured fatal events and the process drains and exits with 1.
- **Performance as data grows.** The first load test showed that listing history slowed
  down as orders accumulated: at ~146,000 stored orders `GET /orders?limit=20` managed only
  123 requests/s with a p99 of 4.4 s, because every call copied and reversed all orders to
  return 20. Expired idempotency keys were also found by scanning every record. I changed
  the store to keep per-partner id lists so a page is a slice from the end, and made the
  expiry sweep stop at the first unexpired record: history paging went to ~5,900 req/s
  with a p99 of 16 ms at ~176,000 orders, and create-with-key throughput doubled. Memory
  still grows with every order (~1.5 GB at ~176,000), which is inherent to the in-memory
  design and a reason for a database in production.
- **Keeping documentation honest.** A hand-written OpenAPI document drifts. Contract tests
  now validate real responses against it and fail if any documented response or error
  code is never exercised; I confirmed they catch drift by removing a field from the docs.
- **Deciding what not to build.** Redis and a database were tempting, but the brief says
  data must not survive a restart, and nothing in the request path is slow enough to need
  caching (section 4).
- **Current tool versions** (TypeScript 6, Express 5, Zod 4, Jest 30) behave differently
  from older guides, e.g. `req.query` is read-only in Express 5 and TypeScript 6 changed
  several compiler defaults.

## 4. Production changes and controls

**Already in place in this repository**

- API-key authentication (only SHA-256 hashes stored, constant-time comparison, rotation),
  per-partner data isolation, per-IP and per-partner rate limits, idempotency keys,
  helmet security headers, `no-store` caching, strict validation, request size limits and
  server timeouts.
- Structured JSON logs with request ids and response times, plus audit events for failed
  authentication, rate limiting, order creation and idempotency conflicts.
- Liveness/readiness probes, graceful shutdown, fatal-error handling, fail-fast
  configuration.
- A repeatable load test (`npm run perf`) with documented results: a 2-stock order costs
  ~0.15 ms of server time, ~8,000 creates/s from one process at 50 concurrent connections
  (p99 11 ms) on a 4-vCPU VM.
- A non-root Docker image without package managers; CI with lint, type-check, 320 tests,
  coverage, build, dependency audit, image smoke test, Trivy image scan, gitleaks secret
  scan, CodeQL and Dependabot. The threat model is in [SECURITY.md](SECURITY.md).

**What I would add to run it for real**

- **Persistence:** PostgreSQL with `NUMERIC` columns for money, migrations, constraints,
  transactions, backups and encryption at rest, behind the existing `OrderRepository`.
- **Shared state across instances:** Redis for rate-limit counters and idempotency records
  (`SET NX` with an expiry), or rate limiting at the API gateway.
- **Stronger partner authentication:** mTLS or OAuth2 client credentials (or HMAC-signed
  requests with timestamp and nonce) instead of static keys; keys in a secrets manager
  with automatic rotation.
- **Edge:** API gateway with TLS termination, WAF and DDoS protection.
- **Market correctness:** a real exchange calendar (holidays, half days), live market data
  with price timestamps and staleness checks, limits on how far a partner price may differ
  from the market, holdings checks for SELL, minimum order sizes per symbol.
- **Execution:** sending orders to a broker asynchronously through a durable queue or the
  outbox pattern, with retries, de-duplication, a dead-letter queue and order status
  updates beyond `SCHEDULED`.
- **Business controls:** per-partner limits on order value and daily volume, with alerts
  driven by the audit events.
- **Scaling and load:** run one process per CPU core or several replicas behind the load
  balancer (which needs the shared stores above), with load tests in a production-like
  environment, including the database, as a release gate.
- **Operations:** metrics (latency percentiles, error rates), distributed tracing,
  centralised and retained logs, alerting, separate environments, CI/CD with rollback,
  signed images, read-only container filesystems, and regular penetration testing.

**Why I did not add Redis now:** the brief requires that data does not survive a restart,
and Redis is a separate server whose data would. Nothing in the request path is expensive
enough to cache either — the calculation takes microseconds and prices are either sent by
the partner or fixed. Redis becomes useful for shared state once there are several
instances, and each of those places is already behind an interface or a configurable store.

## 5. LLM usage

I used **Claude (Anthropic)** throughout, as a pair programmer working directly in my
local repository.

**How it was used**

- **Analysing the brief:** I gave it my development plan and the brief and asked it to
  compare them. It confirmed that every requirement was covered and pointed out gaps, for
  example that the cent rounding for uneven splits was undefined, that the execution
  cut-off rule was missing, and that a time-zone library was needed. It proposed rules
  for both open questions; I reviewed them and chose them.
- **Writing code, tests and documentation:** it generated the implementation, the tests,
  the README, SECURITY.md and drafts of these answers, stage by stage, with one commit per
  stage. Most of the code in this repository was written by the LLM.
- **Directing scope and reviewing:** I set the direction at each step and asked for the
  production work explicitly: which middleware the app uses and what a production-grade
  service needs, whether the security was sufficient, whether Redis was needed (it
  advised against, for the reasons in section 4, and I agreed), and whether error
  handling and request/response validation were done properly. That last review is what
  found the 500-for-a-corrupt-body bug, the exit-code-0 bug and the missing
  uncaught-exception handling.

**How the output was validated**

- Build, lint, type-check and the full test suite ran on my machine after every stage;
  CI runs them again on Node 22 and 24, then builds and smoke-tests the Docker image.
- The real server was started and every endpoint exercised with curl, including error
  cases, rate limits and graceful shutdown; a fresh clone from GitHub was installed,
  built, tested and started.
- Calculations were checked by hand, e.g. 33.33 ÷ 187.43 = 0.1778… → 0.177 shares, and
  scheduler dates against a calendar (both DST changes, Friday → Monday).
- The contract tests were checked by deliberately breaking the documentation and
  confirming that the suite failed.
- A load test measured throughput and latency before and after changes; it is how the
  slow history paging was found and how the fix was confirmed.
- Generated code was not accepted on trust: the defects listed in section 3 were found by
  tests and by running the real process, and fixed with regression tests.
