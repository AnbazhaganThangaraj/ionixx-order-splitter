# Ionixx Order Splitter

[![CI](https://github.com/AnbazhaganThangaraj/ionixx-order-splitter/actions/workflows/ci.yml/badge.svg)](https://github.com/AnbazhaganThangaraj/ionixx-order-splitter/actions/workflows/ci.yml)

A REST API for a robo-advisor's model-portfolio offering. A partner sends a user's model
portfolio and a total amount to **buy or sell**; the API returns the **amount and number of
shares** for each stock, **when** the orders should execute (markets open Monday–Friday),
and the **history** of orders. Node.js + TypeScript + Express; data lives in memory and does
not survive a restart, as the brief requires.

| Document                                       | Contents                                                   |
| ---------------------------------------------- | ---------------------------------------------------------- |
| [docs/API.md](docs/API.md)                     | Full API reference: fields, responses, idempotency, errors |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable, authentication setup           |
| [docs/PRODUCTION.md](docs/PRODUCTION.md)       | Middleware pipeline, security and operational controls, CI |
| [SECURITY.md](SECURITY.md)                     | Threat model (STRIDE), API key management, audit events    |
| [docs/TESTING.md](docs/TESTING.md)             | Test layers and coverage                                   |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)     | Load-test method, results and findings                     |

## Quick start

Prerequisites: **Node.js 22 or newer** (see `.nvmrc`) and npm.

```bash
git clone https://github.com/AnbazhaganThangaraj/ionixx-order-splitter.git
cd ionixx-order-splitter
cp .env.example .env   # local development settings (AUTH_DISABLED=true)
npm install
npm run build
npm start              # http://localhost:3000, Swagger UI at /docs
```

`npm run dev` starts with auto-reload. The app **refuses to start without authentication
configured**: `.env.example` disables it explicitly for local use; in production configure
`API_KEY_HASHES` (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md)). With Docker
(production mode, non-root):

```bash
docker build -t ionixx-order-splitter .
docker run --rm -p 3000:3000 -e API_KEY_HASHES="partner-a:<sha256-hex>" ionixx-order-splitter
```

## API at a glance

| Method | Path                            | Purpose                                   | Success |
| ------ | ------------------------------- | ----------------------------------------- | ------- |
| POST   | `/api/v1/orders`                | Calculate and create a split order        | 201     |
| GET    | `/api/v1/orders`                | The partner's order history, newest first | 200     |
| GET    | `/api/v1/orders/{orderId}`      | One order                                 | 200     |
| GET    | `/health/live`, `/health/ready` | Liveness and readiness probes             | 200     |

The example from the brief, USD 100 into AAPL 60% / TSLA 40% at the default price:

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"100","portfolio":[{"symbol":"AAPL","allocation":"60"},{"symbol":"TSLA","allocation":"40"}]}'
```

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

Send `"marketPrice": "187.43"` on a stock to override the default price. Monetary values
and quantities are decimal strings. Errors share one shape,
`{ "error": { "code", "message", "details" }, "requestId" }`, with stable codes and messages
that say how to fix the request (see [docs/API.md](docs/API.md)). Every response time is
logged to the console in milliseconds (`durationMs`).

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
order includes a warning. **If every line rounds down to zero, nothing would trade, so
the order is rejected** with `422 ORDER_NOT_EXECUTABLE` and is not stored.

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
daylight-saving changes. **Public holidays are not considered** (see Assumptions).

**6. Exact arithmetic.** All money, percentage, price and quantity calculations use
`decimal.js`; JavaScript floating-point numbers are never used for these values.

## Architecture

Layered, with business logic out of the HTTP layer and the parts most likely to change
behind interfaces:

```text
HTTP → middlewares (security headers, request id, timing, rate limits, auth, idempotency)
     → controllers (validate with Zod → domain command; shape the response)
     → OrderService (use cases; depends only on ports and domain types)
          ├─ PortfolioCalculator → OrderCalculator (pure decimal maths)
          ├─ MarketScheduler     → WeekdayMarketScheduler (Luxon, exchange time zone)
          └─ OrderRepository     → InMemoryOrderRepository
     → error handler (AppError / domain errors → one JSON error format)
```

Concrete implementations, the clock, id generator and logger are wired in one place
(`src/app.ts`), so a database or an exchange calendar can replace the POC versions and
tests can fix the time. Business failures are domain errors (`src/domain/errors.ts`)
mapped to HTTP only at the edge.

```text
src/  app.ts (composition root) · server.ts (startup, shutdown, fatal errors)
      config/ controllers/ docs/ domain/ errors/ lib/ middlewares/
      repositories/ routes/ services/ validators/
tests/ unit/ integration/ contract/ (responses vs OpenAPI) e2e/ (real process) fixtures/ helpers/
perf/  load-test.ts
```

## Scripts

| Command                                                 | What it does                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`                                           | Start with auto-reload                                                     |
| `npm run build` / `npm start`                           | Compile to `dist/` / run the compiled app                                  |
| `npm test`                                              | Unit, integration, contract and end-to-end tests                           |
| `npm run test:coverage`                                 | Tests with a coverage report in `coverage/`                                |
| `npm run lint` / `npm run typecheck` / `npm run format` | ESLint (strict, type-aware) / tsc / Prettier                               |
| `npm run perf`                                          | Load test the compiled server ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)) |
| `npm run hash-key`                                      | Generate a partner API key and its hash                                    |

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

## Production controls, in short

API-key authentication (hashed keys, per-partner data isolation, fails closed), per-IP
and per-partner rate limits, `Idempotency-Key` support, security headers, audit events,
liveness/readiness probes with graceful shutdown, fatal-error handling, a non-root Docker
image, and CI with tests, coverage, CodeQL, Trivy, gitleaks and Dependabot. Details:
[docs/PRODUCTION.md](docs/PRODUCTION.md) and [SECURITY.md](SECURITY.md).

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

## Assumptions and limitations

- **Amounts** are USD values with up to 2 decimal places; USD is the only currency.
- **Allocations** must be positive and add up to exactly 100; other totals are rejected,
  not rescaled. Duplicate symbols are rejected. Unknown fields are rejected, so a typo
  such as `markePrice` cannot silently fall back to the default price.
- **SELL** uses the same value-based split as BUY; holdings are not part of the input, so
  they are not checked.
- **Execution:** New York, 09:30–16:00, Monday–Friday (configurable). "Immediately" means
  at the request time: this service schedules orders, it does not send them to a broker.
  **No holiday calendar** (e.g. Thanksgiving would still be scheduled); the scheduler is
  behind an interface so a real exchange calendar can replace it.
- **In-memory state** (orders, rate-limit counters, idempotency records) is per process
  and lost on restart, as the brief requires; memory grows with every stored order.
- **Clients are partner servers**, not browsers: no CORS.
