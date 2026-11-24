# Answers

Responses to the five questions in the Ionixx Backend Developer Technical Challenge.

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
  few leftover cents go to the stocks that lost the most to rounding (the largest-remainder
  method), so the lines add up exactly to the total and every stock is within one cent of
  its exact share; share quantities are rounded down to the configured precision, and the
  unspent cash is reported (`residualAmount`) rather than lost.

**Design around the money.** All amounts, percentages, prices and quantities use exact
decimal arithmetic (`decimal.js`) and travel through the API as decimal strings, never as
JavaScript floats. Every rounding mode is explicit.

**Layered structure, with the parts most likely to change behind interfaces.** Thin
controllers that turn validated input into domain commands; an `OrderService` that
depends only on interfaces (`PortfolioCalculator`, `MarketScheduler`, `OrderRepository`,
`Clock`, `AuditLog`) and domain types; business failures raised as domain errors and
mapped to HTTP only at the edge; all concrete implementations wired in one place
(`createApp()`). This keeps the maths trivially testable, lets tests fix the time and use
simple hand-written fakes, and means a database, a real exchange calendar or a shared
cache can replace the POC versions without touching the business logic. The HLD and LLD
diagrams are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

**Then have it reviewed independently.** Finally I had the code reviewed by a separate
reviewer that had not written it (a fresh AI agent with no knowledge of how the code was
built), judging SOLID principles and production standards with file-and-line evidence.
It scored the code 7/10 on both and found real problems, including two high-severity ones
(section 3). I fixed every agreed finding with regression tests, and trimmed the README
so the core solution comes first and the production extras live in `docs/`.

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
  residual cash, and a warning on the order. If **every** stock rounds down to zero shares,
  nothing would trade, so the order is **rejected** (422 `ORDER_NOT_EXECUTABLE`) rather
  than stored and scheduled.
- Leftover cents from splitting go to the stocks with the **largest rounding remainders**
  (ties to the earlier stock), so no stock is pushed away from its weight by more than a cent.
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
  is acceptable for a POC. Each partner sees only its own orders. Authentication **fails
  closed**: the app will not start without keys unless `AUTH_DISABLED=true` is set
  explicitly (local development only; refused in production), in which case everything
  runs as one `anonymous` partner.
- The `Idempotency-Key` header is **optional**; only successful responses are stored for
  replay, so a corrected request can reuse its key.

## 3. What challenges did you face when creating your solution?

- **Rounding in two places.** Rounding cents per stock and rounding shares per stock each
  create small differences. The challenge was keeping the totals always consistent (lines
  sum exactly to the total) while never letting money disappear, and without distorting
  the portfolio. My first rule gave all leftover cents to the last stock; the independent
  review showed that $199.99 over 100 stocks at 1% gave the last stock $2.98, about 50%
  over its weight. I switched to the largest-remainder method. Property-style tests now
  check the invariants: lines add up to the total, every line is within one cent of its
  exact share, value never exceeds the amount, residual is never negative.
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
- **Defects found by the independent review**, all fixed with regression tests:
  - **Rate limiting and authentication could be bypassed with a bad body.** The JSON body
    parser ran globally, before the rate limiter and the API-key check, so anonymous
    clients could send malformed or oversized bodies without being counted, throttled or
    audited. Bodies are now parsed only on `POST`, after rate limiting and authentication.
  - **Authentication failed open.** With `NODE_ENV` unset and no keys, every request ran
    unauthenticated with only a warning. It now refuses to start unless authentication is
    configured or explicitly disabled outside production.
  - **Orders that trade nothing were accepted** and scheduled; they are now rejected with 422.
  - **Layering:** services imported types from the validation layer and threw an
    HTTP-specific error, and two dependencies were concrete classes. I moved the command
    types into the domain, introduced interfaces for the calculator and the use cases, and
    made business failures domain errors mapped to HTTP at the edge, which also made
    `OrderService` easy to unit test with fakes.
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

## 4. If you were to migrate your code from its current standalone format to a fully functional production environment, what are some changes and controls you would put in place (e.g. security controls)?

Today the service is a single standalone process: state is in memory, prices are fixed
or sent by the partner, and orders are scheduled but never sent to a broker. Some
production controls are already built (below); the rest of this answer is what I would
change to run it for real, grouped by concern. The target architecture is drawn in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#proposed-production-architecture).

**Already in place in this repository**

- API-key authentication that fails closed (only SHA-256 hashes stored, constant-time
  comparison, rotation), per-partner data isolation, per-IP and per-partner rate limits
  applied before any request body is parsed, idempotency keys,
  helmet security headers, `no-store` caching, strict validation, request size limits and
  server timeouts.
- Structured JSON logs with request ids and response times, plus audit events for failed
  authentication, rate limiting, order creation and idempotency conflicts.
- Liveness/readiness probes, graceful shutdown, fatal-error handling, fail-fast
  configuration.
- A repeatable load test (`npm run perf`) with documented results: a 2-stock order costs
  ~0.15 ms of server time, ~8,000 creates/s from one process at 50 concurrent connections
  (p99 11 ms) on a 4-vCPU VM.
- A non-root Docker image without package managers; CI with lint, type-check, 368 tests
  (unit, integration, OpenAPI contract and real-process end-to-end), coverage, build,
  dependency audit, image smoke test, Trivy image scan, gitleaks secret scan, CodeQL and
  Dependabot. The threat model is in [SECURITY.md](SECURITY.md); the proposed production
  architecture is drawn in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

**Why I did not add a message queue now:** the work is synchronous and takes well under
a millisecond, nothing consumes events yet, and SQS or Kafka would keep messages across
restarts, which the brief rules out. In production a queue is how `executeAt` becomes an
actual execution: an outbox plus SQS (or a scheduler such as EventBridge) releases each
order at its time, with retries, idempotent consumers and a dead-letter queue; Kafka would
fit later if several consumers (audit, risk, reporting) need the same order events.

**Why I did not add Redis now:** the brief requires that data does not survive a restart,
and Redis is a separate server whose data would. Nothing in the request path is expensive
enough to cache either — the calculation takes microseconds and prices are either sent by
the partner or fixed. Redis becomes useful for shared state once there are several
instances, and each of those places is already behind an interface or a configurable store.

## 5. If you've used LLMs to solve the challenge, describe how and where you've used it and how did it help you in tackling the challenge? Provide specific examples and details.

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
  uncaught-exception handling. I also asked for the load test and the architecture
  diagrams.
- **Independent review:** I asked for a separate agent, with no knowledge of how the
  code was written, to review it for SOLID principles and production standards. It ran
  the build and tests itself and reported findings with file-and-line evidence; I decided
  which to fix (for example, rejecting orders that trade nothing with 422, and documenting
  rather than capping memory growth) and which to leave (a pluggable price source, which
  the brief's fixed price does not need).

**How it helped**

- **Turning an ambiguous brief into explicit decisions early.** The comparison of my plan
  with the brief surfaced the open questions (cut-off time, time zone, where leftover cents
  go) before any code existed, so they became documented assumptions instead of surprises.
- **Speed with a safety net.** Building stage by stage, with tests and a commit per stage,
  meant each step was small enough to check before moving on, and the commit history
  shows how the solution grew.
- **Exploring trade-offs before committing to them.** I used it to weigh options I then
  decided on: whether Redis or a message queue (SQS, Kafka) belonged in this solution (no,
  for the reasons in section 4), which security controls were worth building for a
  take-home versus documenting, and how to reject orders that trade nothing.
- **Finding defects I would not have looked for.** Specific examples, all now covered by
  regression tests:
  - a load test showed history listing collapsing to 123 requests/s with a 4.4 s p99 at
    ~146,000 orders, because every call copied all orders; after the fix: ~5,900 requests/s,
    p99 16 ms at ~176,000 orders;
  - the error-handling review found that a corrupt compressed body returned 500 and that a
    port clash exited with code 0;
  - the independent review found the JSON body was parsed before rate limiting and
    authentication, that authentication failed open without `NODE_ENV`, and that the
    "last stock takes the leftover cents" rule could put a stock about 50% over its weight.
- **Documentation that stays true.** Contract tests tie the OpenAPI document to real
  responses, and the README, API reference, threat model, performance report and
  architecture diagrams were written from the code, then checked against it.

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
- An independent review agent checked the finished code against SOLID principles and
  production standards; its findings were verified against the code before being fixed.
- Generated code was not accepted on trust: the defects listed in section 3 were found by
  tests, by running the real process and by the independent review, and fixed with
  regression tests.
