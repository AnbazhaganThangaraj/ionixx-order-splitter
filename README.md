# Ionixx Order Splitter

[![CI](https://github.com/AnbazhaganThangaraj/ionixx-order-splitter/actions/workflows/ci.yml/badge.svg)](https://github.com/AnbazhaganThangaraj/ionixx-order-splitter/actions/workflows/ci.yml)

A REST API for a robo-advisor's model-portfolio offering. A partner sends a user's
model portfolio and a total amount to **buy or sell**. The API responds with:

- the **amount** and **number of shares** for each stock in the portfolio,
- **when** the orders should be executed (markets open Monday to Friday), and
- the **history** of orders created since the application started.

Built with **Node.js + TypeScript + Express**. Data lives in memory and does not
survive a restart, as the brief requires.

---

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [API](#api)
- [Business rules](#business-rules)
- [Production readiness](#production-readiness)
- [Architecture](#architecture)
- [Testing](#testing)
- [Performance](#performance)
- [Dependencies](#dependencies)
- [Assumptions and limitations](#assumptions-and-limitations)

---

## Quick start

Prerequisites: **Node.js 22 or newer** (see `.nvmrc`; CI runs Node 22 and 24) and npm.

```bash
git clone https://github.com/AnbazhaganThangaraj/ionixx-order-splitter.git
cd ionixx-order-splitter
npm install
npm run build
npm start            # http://localhost:3000
```

For development with auto-reload: `npm run dev`.

Every setting has a safe default, so no `.env` file is needed. To change settings,
copy `.env.example` to `.env` and edit it.

**Authentication is off by default for local development** (the server logs a warning)
so the examples below work as they are. To run with authentication, as production does:

```bash
API_KEYS="partner-a:replace-with-a-long-random-key-123456" npm start
# then send the header on every /api/v1 request:
#   -H 'X-API-Key: replace-with-a-long-random-key-123456'
```

In production, configure **hashes** instead of keys, so the keys never sit in config:

```bash
npm run hash-key -- --generate partner-a   # prints a new key (give to the partner) and its hash
API_KEY_HASHES="partner-a:<sha256-hex>" NODE_ENV=production npm start
```

With `NODE_ENV=production` the app refuses to start unless keys are configured.
See [SECURITY.md](SECURITY.md) for the threat model and key management.

**Run with Docker** (production image, non-root, `NODE_ENV=production`):

```bash
docker build -t ionixx-order-splitter .
docker run --rm -p 3000:3000 \
  -e API_KEY_HASHES="partner-a:<sha256-hex>" \
  ionixx-order-splitter
```

Interactive API docs (Swagger UI): **http://localhost:3000/docs**
(raw OpenAPI document: `/docs/openapi.json`).

---

## Configuration

| Variable                  | Default            | Description                                                                                                                            |
| ------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                    | `3000`             | HTTP port                                                                                                                              |
| `NODE_ENV`                | `development`      | `development`, `test` or `production`                                                                                                  |
| `LOG_LEVEL`               | `info`             | pino level (`silent` … `trace`)                                                                                                        |
| `DEFAULT_STOCK_PRICE`     | `100`              | Price (USD) used when the partner does not send `marketPrice`                                                                          |
| `QUANTITY_PRECISION`      | `3`                | Decimal places allowed for share quantities (0–10), e.g. `7`                                                                           |
| `MARKET_TIMEZONE`         | `America/New_York` | IANA time zone of the exchange                                                                                                         |
| `MARKET_OPEN_TIME`        | `09:30`            | Session open, `HH:mm`, in the exchange time zone                                                                                       |
| `MARKET_CLOSE_TIME`       | `16:00`            | Session close, `HH:mm`, in the exchange time zone (exclusive)                                                                          |
| `API_KEY_HASHES`          | _(empty)_          | `partnerId:sha256hex,…` — production format (see `npm run hash-key`)                                                                   |
| `API_KEYS`                | _(empty)_          | `partnerId:key,…` plaintext keys (≥ 24 chars), for local development. With neither set, auth is off; **one is required in production** |
| `PARTNER_RATE_LIMIT_MAX`  | `600`              | Max `/api/v1` requests per authenticated partner per window                                                                            |
| `RATE_LIMIT_MAX`          | `100`              | Max `/api/v1` requests per client IP per window                                                                                        |
| `RATE_LIMIT_WINDOW_MS`    | `60000`            | Rate-limit window in milliseconds                                                                                                      |
| `IDEMPOTENCY_TTL_SECONDS` | `86400`            | How long an `Idempotency-Key` response can be replayed                                                                                 |
| `TRUST_PROXY`             | `0`                | Number of proxies/load balancers in front (0 = ignore `X-Forwarded-For`)                                                               |

Configuration is validated on startup. If any value is invalid, the process prints
every problem and exits with code 1 instead of calculating with bad settings:

```text
$ QUANTITY_PRECISION=-1 npm start
Invalid configuration:
  - QUANTITY_PRECISION: Too small: expected number to be >=0
```

Changing the quantity precision from 3 to 7 is a configuration change only:

```bash
QUANTITY_PRECISION=7 npm start
```

---

## Scripts

| Command                 | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `npm run dev`           | Start with auto-reload (tsx watch)                              |
| `npm run build`         | Compile TypeScript to `dist/`                                   |
| `npm start`             | Run the compiled app (`node dist/server.js`)                    |
| `npm test`              | Run all unit and integration tests                              |
| `npm run test:coverage` | Tests with a coverage report in `coverage/`                     |
| `npm run lint`          | ESLint (strict, type-aware rules)                               |
| `npm run typecheck`     | Type-check source and tests without emitting                    |
| `npm run format`        | Format with Prettier                                            |
| `npm run perf`          | Load test the compiled server (see [Performance](#performance)) |
| `npm run hash-key`      | Generate an API key and its hash (`-- --generate <partnerId>`)  |

---

## API

Base path: `/api/v1`. All bodies are JSON. When API keys are configured, every `/api/v1`
request needs an **`X-API-Key`** header, and each partner only ever sees its own orders. **Monetary values, percentages, prices and
quantities are decimal strings** (e.g. `"100.50"`). JSON numbers are accepted as input
too, but strings are preferred because JSON numbers are binary floating point.

| Method | Path                       | Purpose                                   | Success |
| ------ | -------------------------- | ----------------------------------------- | ------- |
| POST   | `/api/v1/orders`           | Calculate and create a split order        | 201     |
| GET    | `/api/v1/orders`           | Order history, newest first, paged        | 200     |
| GET    | `/api/v1/orders/{orderId}` | One order                                 | 200     |
| GET    | `/health/live`             | Liveness probe (`/health` is an alias)    | 200     |
| GET    | `/health/ready`            | Readiness probe (503 while shutting down) | 200     |
| GET    | `/docs`                    | Swagger UI                                | 200     |

### Create an order

**Request fields**

| Field                     | Type           | Required | Rules                                                           |
| ------------------------- | -------------- | -------- | --------------------------------------------------------------- |
| `orderType`               | string         | yes      | `BUY` or `SELL`                                                 |
| `totalAmount`             | decimal string | yes      | > 0, at most 2 decimal places, at most 1,000,000,000            |
| `currency`                | string         | no       | `USD` (default and only supported value)                        |
| `portfolio`               | array          | yes      | 1–100 stocks                                                    |
| `portfolio[].symbol`      | string         | yes      | Ticker such as `AAPL` or `BRK.B`; upper-cased; must be unique   |
| `portfolio[].allocation`  | decimal string | yes      | Percent, > 0, at most 4 decimal places; all must sum to **100** |
| `portfolio[].marketPrice` | decimal string | no       | > 0; **overrides the default price** for that stock             |

Unknown fields are rejected, so a typo such as `markePrice` fails loudly instead of
silently falling back to the default price.

**Example: the scenario from the brief** (USD 100 into AAPL 60% / TSLA 40%)

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "orderType": "BUY",
    "totalAmount": "100",
    "currency": "USD",
    "portfolio": [
      { "symbol": "AAPL", "allocation": "60" },
      { "symbol": "TSLA", "allocation": "40" }
    ]
  }'
```

Response `201 Created` (with `Location: /api/v1/orders/{orderId}`):

```json
{
  "orderId": "096eecb5-de2f-4469-be10-7490a1c222ac",
  "partnerId": "anonymous",
  "orderType": "BUY",
  "status": "SCHEDULED",
  "currency": "USD",
  "totalAmount": "100.00",
  "quantityPrecision": 3,
  "lines": [
    {
      "symbol": "AAPL",
      "allocationPercent": "60",
      "allocatedAmount": "60.00",
      "price": "100.00",
      "priceSource": "DEFAULT",
      "quantity": "0.600",
      "estimatedValue": "60.00",
      "residualAmount": "0.00"
    },
    {
      "symbol": "TSLA",
      "allocationPercent": "40",
      "allocatedAmount": "40.00",
      "price": "100.00",
      "priceSource": "DEFAULT",
      "quantity": "0.400",
      "estimatedValue": "40.00",
      "residualAmount": "0.00"
    }
  ],
  "totals": { "allocatedAmount": "100.00", "estimatedValue": "100.00", "residualAmount": "0.00" },
  "execution": {
    "executeAt": "2026-11-23T09:30:00.000-05:00",
    "timeZone": "America/New_York",
    "reason": "WEEKEND"
  },
  "warnings": [],
  "createdAt": "2026-11-21T15:52:32.053Z"
}
```

**Response fields per line**

- `allocatedAmount` – this stock's share of `totalAmount`, in cents
- `price` / `priceSource` – the price used and whether it came from the partner (`PARTNER`) or the default (`DEFAULT`); this is the price at the time the order was created
- `quantity` – shares to buy or sell, rounded **down** to `quantityPrecision`
- `estimatedValue` – `quantity × price`, in cents
- `residualAmount` – cash left over because the quantity was rounded down

**Example: partner prices and a SELL order**

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "orderType": "SELL",
    "totalAmount": "250.00",
    "portfolio": [
      { "symbol": "AAPL", "allocation": "60", "marketPrice": "187.43" },
      { "symbol": "TSLA", "allocation": "40" }
    ]
  }'
```

AAPL uses the partner's 187.43 (`priceSource: "PARTNER"`, quantity `0.800`);
TSLA uses the default 100.00 (quantity `1.000`).

### Safe retries with `Idempotency-Key`

If a partner's request times out, it cannot know whether the order was created.
Sending an `Idempotency-Key` header makes the retry safe:

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 7d1f3c2a-order-0001' \
  -d '{ "orderType": "BUY", "totalAmount": "100", "portfolio": [{ "symbol": "AAPL", "allocation": "100" }] }'
```

| Situation                                    | Result                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| First request with the key                   | Processed normally (201)                                                          |
| Retry with the same key and the same body    | The original response is replayed, with `Idempotent-Replayed: true`; no new order |
| Same key, different body                     | `422 IDEMPOTENCY_KEY_REUSED`                                                      |
| Retry while the first is still being handled | `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`                                             |
| First attempt failed (e.g. 400)              | Nothing is stored; the corrected request may reuse the key                        |

Keys are scoped per partner and remembered for `IDEMPOTENCY_TTL_SECONDS` (24 h).

### List order history

```bash
curl -s 'http://localhost:3000/api/v1/orders?limit=10&offset=0&orderType=BUY'
```

| Query       | Default | Rules           |
| ----------- | ------- | --------------- |
| `limit`     | 20      | integer 1–100   |
| `offset`    | 0       | integer ≥ 0     |
| `orderType` | (all)   | `BUY` or `SELL` |

```json
{
  "data": [{ "orderId": "…", "orderType": "BUY", "…": "…" }],
  "pagination": { "limit": 10, "offset": 0, "total": 1 }
}
```

An empty history returns `200` with `"data": []`.

### Get one order

```bash
curl -s http://localhost:3000/api/v1/orders/096eecb5-de2f-4469-be10-7490a1c222ac
```

### Errors

Every error has the same shape. Branch on `code` (stable); `message` and `details`
are written for the developer reading them and say what was wrong and how to fix it:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed: 3 problems found (see details)",
    "details": [
      { "path": "orderType", "message": "is required (one of BUY, SELL)" },
      {
        "path": "portfolio",
        "message": "allocations must add up to exactly 100 (got 90, 10 short)"
      },
      {
        "path": "portfolio[0]",
        "message": "unknown field(s): markePrice; allowed fields: symbol, allocation, marketPrice"
      }
    ]
  },
  "requestId": "6f1c8d2e-0b7a-4f3e-9c41-2d5e8a7b9c10"
}
```

| Status | `code`                            | When                                                      | Example message                                                                           |
| ------ | --------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`                | A field, query parameter or path parameter is invalid     | `Request validation failed: 2 problems found (see details)`                               |
| 400    | `INVALID_JSON`                    | Body is not valid JSON (details give the position)        | `Request body is not valid JSON; send a JSON object`                                      |
| 400    | `BAD_REQUEST`                     | Body cannot be read, e.g. a corrupt gzip/br body          | `Request body could not be read: Decompression failed`                                    |
| 401    | `UNAUTHORIZED`                    | API key missing or wrong (when auth is enabled)           | `API key is missing: send your key in the X-API-Key header`                               |
| 404    | `NOT_FOUND`                       | Unknown order id (or another partner's), or unknown route | `Order 3f2b… not found`                                                                   |
| 405    | `METHOD_NOT_ALLOWED`              | Known route, unsupported method (`Allow` header is set)   | `Method DELETE is not allowed on /api/v1/orders; allowed: GET, POST, HEAD, OPTIONS`       |
| 409    | `IDEMPOTENCY_REQUEST_IN_PROGRESS` | Same `Idempotency-Key` is still being processed           | `A request with this Idempotency-Key is still being processed; retry shortly`             |
| 413    | `PAYLOAD_TOO_LARGE`               | Body larger than 100 kb                                   | `Request body is too large (limit 100kb)`                                                 |
| 415    | `UNSUPPORTED_MEDIA_TYPE`          | Not JSON, or unsupported charset / `Content-Encoding`     | `Content-Type must be application/json (got "text/plain")`                                |
| 422    | `IDEMPOTENCY_KEY_REUSED`          | `Idempotency-Key` reused with a different body            | `…; use a new key for a new request, or resend the original body…`                        |
| 429    | `RATE_LIMITED`                    | Too many requests from this IP (`Retry-After` is set)     | `Too many requests from this IP address (limit 100 per 1 min); retry in 42 s`             |
| 429    | `PARTNER_QUOTA_EXCEEDED`          | The partner's quota is used up (`Retry-After` is set)     | `Partner request quota exceeded (limit 600 per 1 min); retry in 42 s`                     |
| 500    | `INTERNAL_ERROR`                  | Unexpected failure; details are logged, never returned    | `An unexpected error occurred. Please retry later; … contact support with the requestId.` |

The full list of codes lives in `src/errors/error-codes.ts`; the OpenAPI document and
the contract tests use it, so an undocumented code cannot reach a client.

**Failures outside a request** are handled too: an unhandled promise rejection or
uncaught exception is logged as a structured `fatal` line (with stack), readiness turns
503, connections drain for up to 3 s and the process exits with code 1 so the
orchestrator restarts it. If the port is already in use, startup fails with a clear
`fatal` message and exit code 1.

Every response carries an `X-Request-Id` header. A partner may send its own
`X-Request-Id` (letters, digits, `.`, `_`, `-`, up to 64 characters) and it is echoed
back and used in the logs.

### Response times in the console

Every request logs one structured JSON line with its duration in milliseconds,
measured with a monotonic clock (`performance.now()`):

```json
{
  "level": 30,
  "time": "2026-11-21T15:52:32.069Z",
  "service": "ionixx-order-splitter",
  "requestId": "ad9f9e7a-…",
  "method": "POST",
  "route": "/api/v1/orders",
  "statusCode": 201,
  "durationMs": 34.53,
  "clientIp": "::1",
  "partnerId": "anonymous",
  "msg": "POST /api/v1/orders 201 34.53ms"
}
```

Request bodies and API keys are never logged, because they describe a user's
investments or grant access. For
coloured, human-readable logs during development: `npm run dev | npx pino-pretty`.

---

## Business rules

**1. Amount per stock.** `allocatedAmount = totalAmount × allocation ÷ 100`, in whole
cents, using the **largest-remainder method**: every line is rounded **down** to cents,
then the few cents left over go one at a time to the lines that lost the most to rounding
(ties go to the earlier line). The lines always add up **exactly** to `totalAmount`, and
every line is within one cent of its exact share.
Examples: USD 100 at 33.3333 / 33.3333 / 33.3334 → 33.33 + 33.33 + 33.34;
USD 199.99 over 100 stocks at 1% → 2.00 for 99 stocks and 1.99 for one.

**2. Price.** The partner's `marketPrice` if sent, otherwise `DEFAULT_STOCK_PRICE`
(USD 100). An invalid partner price (zero, negative, malformed) is **rejected**, never
silently replaced with the default.

**3. Quantity.** `quantity = allocatedAmount ÷ price`, rounded **down** to
`QUANTITY_PRECISION` decimal places, so an order never exceeds its amount. The unspent
cash is reported as `residualAmount` per line and in `totals`. If an allocation is too
small to trade even the smallest allowed fraction, the line has quantity `0` and the
order includes a warning.

**4. BUY and SELL** use the same maths: `totalAmount` is the value to buy or sell,
split by portfolio weight. Holdings are not part of the input, so SELL quantities are
not checked against what the user owns.

**5. Execution time.** Decided in the exchange time zone (default New York,
09:30–16:00, Monday–Friday):

| Order placed                 | Executes             | `reason`             |
| ---------------------------- | -------------------- | -------------------- |
| Weekday, before open         | Today at open        | `BEFORE_MARKET_OPEN` |
| Weekday, during market hours | Immediately          | `MARKET_OPEN`        |
| Weekday, at or after close   | Next weekday at open | `AFTER_MARKET_CLOSE` |
| Saturday or Sunday           | Monday at open       | `WEEKEND`            |

`executeAt` is an ISO-8601 timestamp with the exchange's UTC offset, and it handles
daylight-saving changes. **Public holidays are not considered** (see below).

**6. Exact arithmetic.** All money, percentage, price and quantity calculations use
`decimal.js`; JavaScript floating-point numbers are never used for these values.

---

## Production readiness

### Middleware pipeline

Every request passes through these layers, in this order (`src/app.ts`):

| #   | Middleware                         | Applies to     | Purpose                                                                      |
| --- | ---------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| 1   | `apiSecurityHeaders()` (helmet)    | all            | Strict CSP (`default-src 'none'`), HSTS, `nosniff`, frame protection         |
| 2   | `connectionDrain()`                | all            | Sends `Connection: close` while shutting down                                |
| 3   | `requestId()`                      | all            | Reuses a safe `X-Request-Id` or creates one; echoed in the response          |
| 4   | `responseTimeLogger()`             | all            | Monotonic timer; one JSON log line per request with `durationMs`             |
| 5   | `express.json({ limit: '100kb' })` | all            | JSON parsing with a body-size limit (413)                                    |
| 6   | `recordMountPath()`                | each router    | Keeps the route name correct in logs, including error paths                  |
| 7   | `docsSecurityHeaders()`            | `/docs`        | Looser CSP so Swagger UI can load its own scripts and styles                 |
| 8   | `noStore()`                        | `/api/v1`      | `Cache-Control: no-store` for financial data                                 |
| 9   | `apiRateLimit()`                   | `/api/v1`      | Per-IP limit (429 + `Retry-After`), before auth to slow key guessing         |
| 10  | `apiKeyAuth()`                     | `/api/v1`      | `X-API-Key` check against stored hashes (constant-time), sets the partner id |
| 11  | `partnerRateLimit()`               | `/api/v1`      | Per-partner quota after authentication (429 `PARTNER_QUOTA_EXCEEDED`)        |
| 12  | `requireJson()`                    | `POST /orders` | 415 unless the body is JSON                                                  |
| 13  | `idempotency()`                    | `POST /orders` | `Idempotency-Key` replay / conflict handling                                 |
| 14  | `methodNotAllowed()`               | known paths    | 405 + `Allow` for unsupported methods; `OPTIONS` → 204                       |
| 15  | `notFound()`                       | unmatched      | 404 in the standard error format                                             |
| 16  | `errorHandler()`                   | all errors     | One error format; unexpected errors become a generic 500                     |

### Security controls

- **Authentication:** per-partner API keys (`X-API-Key`). Only SHA-256 hashes are
  stored (`API_KEY_HASHES`); comparison with `timingSafeEqual`; several keys per partner
  for rotation; keys never logged and redacted by the logger as a safety net.
- **Authorisation:** orders belong to the partner that created them. Another partner's
  order returns 404, not 403, so order ids cannot be probed.
- **Abuse protection:** per-IP rate limit (before auth) and per-partner quota (after
  auth), 100 kb body limit, strict validation that rejects unknown fields and
  prototype-pollution payloads, server timeouts against slow clients.
- **Audit trail:** structured `audit` events for failed authentication, rate limiting,
  order creation and idempotency replays/conflicts (identifiers only, no amounts).
- **Headers:** helmet security headers; `x-powered-by` removed; `no-store` caching.
- **Proxies:** `X-Forwarded-For` is ignored unless `TRUST_PROXY` declares the proxies,
  so the client IP used for rate limiting cannot be spoofed.
- **Errors:** internals (messages, stacks) are logged, never returned to clients.
- **CORS:** deliberately not enabled. Clients are partner servers, not browsers, so no
  cross-origin browser access is granted. Unsupported methods get 405 with `Allow`.

The full threat model (STRIDE), key management and the production backlog are in
[SECURITY.md](SECURITY.md).

### Operations

- **Health probes:** `/health/live` (process up) and `/health/ready` (accepting traffic).
- **Graceful shutdown:** on `SIGTERM`, readiness turns 503, new connections are refused,
  idle keep-alive sockets are closed, in-flight requests finish; forced exit after 10 s.
- **Fail-fast configuration:** invalid settings, or production without API keys, stop
  the process at startup with a clear message.
- **Container:** multi-stage `Dockerfile`; runtime image has production dependencies
  only, no package managers (npm/yarn removed), runs as the unprivileged `node` user,
  with a `HEALTHCHECK`.
- **CI** (`.github/workflows/ci.yml`): format check, lint, type-check, tests with
  coverage, build and production-dependency audit on Node 22 and 24; builds the image,
  smoke-tests it (startup without keys fails, 401 without a key, a real order) and scans
  it with Trivy; gitleaks scans the git history for secrets.
- **Security automation:** CodeQL static analysis (`codeql.yml`) on every push and weekly;
  Dependabot updates for npm packages, GitHub Actions and the Docker base image.

### What this POC still keeps in memory

Rate-limit counters, idempotency records and orders live in process memory, so they are
per instance and lost on restart. Running several instances needs a shared store
(PostgreSQL for orders, Redis for rate limits and idempotency) — each sits behind an
interface or middleware option, so the change is local. See ANSWERS.md.

---

## Architecture

Layered (MVC at the HTTP edge), with business logic kept out of controllers:

```text
HTTP request
  → middlewares   security headers · request id · timing · JSON parsing
                  · rate limit · API-key auth · idempotency
  → routes        map method + path to a controller
  → controllers   validate input (Zod) · call the service · shape the response
  → services      OrderService (use cases)
                    ├─ OrderCalculator   (pure maths: split, price, quantity)
                    ├─ MarketScheduler   (when to execute)
                    └─ OrderRepository   (storage interface)
  → repositories  InMemoryOrderRepository (Map)
  → error middleware → consistent JSON error
```

Collaborators (repository, scheduler, clock, id generator, logger) are passed into
`createApp()`, so a database or a real exchange calendar can replace the POC versions
without changing the service, and tests can fix the clock.

```text
src/
├── app.ts                 # composition root: wires dependencies, builds the Express app
├── server.ts              # loads config, starts listening, graceful shutdown
├── config/                # environment schema, validated on startup
├── controllers/           # thin HTTP handlers
├── docs/                  # OpenAPI document
├── domain/                # Order types and enums
├── errors/                # AppError, ValidationError, NotFoundError
├── lib/                   # decimal.js setup, clock, logger, lifecycle (draining)
├── middlewares/           # security, auth, rate limit, idempotency, timing, errors…
├── repositories/          # order + idempotency store interfaces, in-memory versions
├── routes/                # orders, health, docs
├── services/              # order service, calculator, splitter, quantity, price, scheduler
└── validators/            # Zod schemas and the parse helper
tests/
├── unit/                  # config, validators, calculator parts, scheduler, repository
├── integration/           # HTTP tests with Supertest
├── contract/              # responses validated against the OpenAPI document
├── e2e/                   # real server process: startup failures, shutdown, exit codes
├── fixtures/              # sample requests and orders
└── helpers/               # test app builder with log capture and fixed clock
```

---

## Testing

```bash
npm test                # 320 tests
npm run test:coverage   # coverage report in coverage/
```

### Coverage

![Jest coverage report: 99.25% statements, 89.47% branches, 99.28% functions, 99.34% lines](docs/images/coverage-report.png)

Over 99% of statements, functions and lines are covered, across 318 tests. The
uncovered branches are mostly defensive fallbacks: default values for settings that are
always present after validation, `??` guards in type-narrowing code, and request-reading
error types that Express does not produce in practice. Run `npm run test:coverage` and
open `coverage/lcov-report/index.html` to see the current report.

### What the tests cover

The tests focus on behaviour and edge cases:

- **Validation** – missing fields, wrong types, unsupported order types and currencies,
  allocations not summing to 100, duplicate symbols (any letter case), invalid partner
  prices, unknown fields, NaN/Infinity, decimal-place limits.
- **Calculation** – the brief's example, partner-price precedence, precision 0 / 3 / 7,
  rounding down, uneven splits, tiny amounts, residual cash, and invariants (lines
  always add up to the total; value never exceeds the amount).
- **Scheduler** – every weekday, exact open and close, weekends, dates that differ
  between UTC and New York, both daylight-saving transitions, a non-US market.
- **Repository** – empty history, newest-first ordering, paging, filtering, isolation
  of stored data, empty after "restart".
- **HTTP** – 201/200/400/404/413/415/500 responses, Location header, response-time log
  lines, request bodies not logged, request-id handling.
- **Error messages** (`tests/integration/error-messages.test.ts`) – the exact status,
  code and guidance for every failure case: malformed/empty/oversized bodies, wrong
  content type, charset and encoding, each field rule, unknown fields, auth, 404/405,
  rate limits and idempotency conflicts; client errors never become 500s.
- **API contract** (`tests/contract/`) – real responses are validated against the
  OpenAPI document with ajv. The suite fails if a response doesn't match its schema,
  uses an undocumented status, if any documented response is never exercised, or if any
  error code in the catalogue is never produced.
- **Process level** (`tests/e2e/`) – the real server is started as a child process:
  graceful SIGTERM (exit 0), port already in use, invalid configuration and production
  without keys (exit 1). Fatal-error handlers are unit tested.
- **Production controls** – authentication (missing/wrong/rotated/hashed keys, partner
  isolation, keys not logged), audit events, rate limiting and partner quotas (429,
  `Retry-After`, auth failures counted), 405 handling, prototype pollution, log redaction,
  idempotency (replay, key reuse, concurrent retry, failures not stored), security
  headers, proxy trust, readiness while draining.

---

## Performance

Response times are logged for every request (`durationMs`), and `npm run perf` load-tests
the compiled server in production mode. Highlights from a 4-vCPU Linux VM, with the load
generator on the same machine (full results, method and caveats in
[docs/PERFORMANCE.md](docs/PERFORMANCE.md)):

| Scenario                                    | Single client | 50 concurrent: req/s | 50 concurrent: p99 |
| ------------------------------------------- | ------------: | -------------------: | -----------------: |
| `POST /orders`, 2 stocks                    |       0.15 ms |                8,067 |              11 ms |
| `POST /orders`, 100 stocks (max)            |       0.74 ms |                1,353 |              70 ms |
| `GET /orders/{id}`                          |       0.09 ms |               11,195 |               8 ms |
| `GET /orders?limit=20`, ~176k orders stored |       0.17 ms |                5,873 |              16 ms |

The first load test found that listing history slowed down as orders accumulated
(p99 4.4 s at ~146k orders) and that idempotency-key expiry scanned every record. Both
were fixed (history paging is now independent of the number of stored orders); the
before/after figures are in the performance document.

---

## Dependencies

**Runtime**

| Package              | Why                                                                     |
| -------------------- | ----------------------------------------------------------------------- |
| `express` (v5)       | HTTP framework; v5 forwards errors from async handlers automatically    |
| `zod` (v4)           | Request and configuration validation with typed results                 |
| `decimal.js`         | Exact decimal arithmetic for money and share quantities                 |
| `luxon`              | Time-zone and daylight-saving-aware date calculations for the scheduler |
| `pino`               | Fast structured JSON logging                                            |
| `swagger-ui-express` | Serves the interactive API documentation at `/docs`                     |
| `helmet`             | Security headers (CSP, HSTS, nosniff, frame protection)                 |
| `express-rate-limit` | Per-client request limits with standard `RateLimit` headers             |
| `dotenv`             | Loads an optional `.env` file                                           |

**Development**

| Package                                     | Why                                                        |
| ------------------------------------------- | ---------------------------------------------------------- |
| `typescript`                                | Language and compiler (strict mode)                        |
| `tsx`                                       | Runs TypeScript directly in `npm run dev`                  |
| `jest`, `ts-jest`                           | Test runner with TypeScript support                        |
| `supertest`                                 | In-process HTTP integration tests                          |
| `ajv`, `ajv-formats`                        | Validating responses against the OpenAPI contract in tests |
| `autocannon`                                | HTTP load testing (`npm run perf`)                         |
| `eslint`, `@eslint/js`, `typescript-eslint` | Linting with strict type-aware rules                       |
| `prettier`, `eslint-config-prettier`        | Consistent formatting                                      |
| `@types/*`                                  | Type definitions                                           |

`npm audit` reports moderate advisories in packages used internally by Jest (test
tooling only; nothing in the running service). The suggested automatic fix downgrades
Jest, so it has not been applied.

---

## Assumptions and limitations

The full list, with reasoning, is in [ANSWERS.md](ANSWERS.md). In short:

- **No holiday calendar.** Weekdays only, as the brief states; a US market holiday
  such as Thanksgiving would still be scheduled. The scheduler is behind an interface
  so a real exchange calendar can replace it.
- **"Execute immediately" during market hours** means "at the request time"; this
  service calculates and schedules orders but does not place them with a broker.
- **USD only.** The fixed default price is a USD price.
- **SELL does not check holdings**, because holdings are not part of the input.
- **In-memory storage** by design: history is lost on restart, and it is per process
  (not shared between multiple instances).
- **Single-instance state:** orders, rate-limit counters and idempotency records are in
  memory; see [Production readiness](#production-readiness).
