# Requirements coverage

How every point of the Ionixx Backend Developer Technical Challenge is met: where it is
implemented, which tests prove it, and the use cases covered. Test references are
`file › test name`, so each claim can be checked by running that test.

- [Functional requirements](#functional-requirements)
- [Technical requirements](#technical-requirements)
- [Submission requirements](#submission-requirements)
- [Assessment expectations](#assessment-expectations)
- [Use cases covered](#use-cases-covered)
- [Deliberately out of scope](#deliberately-out-of-scope)

## Functional requirements

| #   | Requirement (from the brief)                                                          | Status | Implementation                                                                                                                                                 | Proven by                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Accept the model portfolio and the total amount to be purchased/sold                  | ✅     | `POST /api/v1/orders` with `orderType`, `totalAmount`, `portfolio[]` (`symbol`, `allocation`, optional `marketPrice`); `src/validators/order.validator.ts`     | `orders.test.ts › creates the brief example…`; `order.validator.test.ts › accepts the example from the brief…`                                                           |
| F2  | Respond with the amount and number of shares to buy/sell for each stock               | ✅     | `lines[].allocatedAmount` and `lines[].quantity` (plus `price`, `priceSource`, `estimatedValue`, `residualAmount`); `src/services/order-calculator.service.ts` | `order-calculator.service.test.ts › produces the brief example: $60 of AAPL and $40 of TSLA…`                                                                            |
| F3  | Respond with when to execute the orders (markets open Monday–Friday)                  | ✅     | `execution.executeAt`, `timeZone`, `reason`; `src/services/market-scheduler.service.ts`                                                                        | `market-scheduler.service.test.ts` (every weekday, open/close boundaries, weekends, time zones, DST); `orders.test.ts › schedules weekend orders for Monday at the open` |
| F4  | Return historic orders                                                                | ✅     | `GET /api/v1/orders` (newest first, paging, `orderType` filter) and `GET /api/v1/orders/{orderId}`                                                             | `orders.test.ts › returns history newest first, with paging and an orderType filter`, `› returns a stored order`                                                         |
| F5  | Configurable decimal places for share quantity (3 today, maybe 7 later)               | ✅     | `QUANTITY_PRECISION` (0–10, default 3); changing it needs no code change                                                                                       | `orders.test.ts › applies the configured quantity precision`; `quantity-calculator.test.ts › respects a precision of 7…`, `› …of 0 (whole shares only)`                  |
| F6  | Fixed stock price of $100                                                             | ✅     | `DEFAULT_STOCK_PRICE` (default `100`)                                                                                                                          | `price-resolver.test.ts › falls back to the configured default…`; `orders.test.ts › applies the configured default price`                                                |
| F7  | A partner-supplied market price takes priority over the fixed price                   | ✅     | `src/services/price-resolver.ts`; response shows `priceSource: PARTNER` or `DEFAULT`                                                                           | `price-resolver.test.ts › uses the partner price when supplied`; `orders.test.ts › uses partner market prices over the default`                                          |
| F8  | The brief's example: USD 100 into AAPL 60% / TSLA 40% → $60 and $40 with share counts | ✅     | Returns 60.00 → 0.600 and 40.00 → 0.400 shares at $100                                                                                                         | `amount-splitter.test.ts › splits the brief example…`; `orders.test.ts › creates the brief example…`                                                                     |

## Technical requirements

| #   | Requirement                                                            | Status | Implementation                                                                                                    | Proven by                                                                                                                                                              |
| --- | ---------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Node.js with TypeScript                                                | ✅     | Node 22+, TypeScript strict mode                                                                                  | CI on Node 22 and 24 (`.github/workflows/ci.yml`)                                                                                                                      |
| T2  | RESTful API design                                                     | ✅     | Resource paths under `/api/v1`, 201 + `Location`, 200, 400, 401, 404, 405 + `Allow`, 409, 413, 415, 422, 429, 500 | `openapi-contract.test.ts` (every documented response produced and schema-checked)                                                                                     |
| T3  | Define the endpoints and how data is taken in (format, data types)     | ✅     | OpenAPI 3.1 at `/docs` and `/docs/openapi.json`; [API.md](API.md); decimals as strings                            | `docs.test.ts › serves the OpenAPI document`; contract tests validate real responses against it                                                                        |
| T4  | Response times instrumented in milliseconds and visible in the console | ✅     | One JSON log line per request with `durationMs` (monotonic clock), e.g. `POST /api/v1/orders 201 0.84ms`          | `orders.test.ts › logs each response time in milliseconds with method, route, status and request id`                                                                   |
| T5  | Flexible for different model portfolios                                | ✅     | 1–100 stocks, any positive weights summing to 100, optional per-stock price                                       | `order.validator.test.ts › accepts a single-stock portfolio at 100%`; `amount-splitter.test.ts › every line is within one cent of its exact share…` (up to 100 stocks) |
| T6  | Flexible for different order types (BUY or SELL)                       | ✅     | `orderType: BUY \| SELL`, same value-based maths                                                                  | `order-calculator.service.test.ts › calculates SELL orders with the same value-based maths as BUY`; `orders.test.ts › creates SELL orders`                             |
| T7  | Data should not survive application restart                            | ✅     | In-memory repository only                                                                                         | `orders.test.ts › data does not survive a restart…`; `in-memory-order.repository.test.ts › starts empty for every new instance…`                                       |
| T8  | Performance is important                                               | ✅     | Load test (`npm run perf`), results and fixes in [PERFORMANCE.md](PERFORMANCE.md)                                 | `in-memory-order.repository.test.ts › pages correctly across partners and types with many orders`                                                                      |

## Submission requirements

| #   | Requirement                                             | Status | Where                                                                                                                                                                                  |
| --- | ------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Source code in a public GitHub repository               | ✅     | `AnbazhaganThangaraj/ionixx-order-splitter` (public)                                                                                                                                   |
| S2  | Must compile                                            | ✅     | `npm run build`; CI builds on every push                                                                                                                                               |
| S3  | README with execution instructions and request examples | ✅     | [README](../README.md): quick start, Docker, and [request examples](../README.md#request-examples) with real responses for BUY, SELL, price override, retries, history and error cases |
| S4  | README documents library and framework dependencies     | ✅     | README › Dependencies (each library and why it is used)                                                                                                                                |
| S5  | ANSWERS file responding to the five questions           | ✅     | [ANSWERS.md](../ANSWERS.md), headings are the questions verbatim                                                                                                                       |

## Assessment expectations

| Expectation                                           | How it is met                                                                                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production-grade quality, coding standards, structure | Layered design with ports and a composition root ([ARCHITECTURE.md](ARCHITECTURE.md)); strict TypeScript; ESLint `strictTypeChecked`; Prettier; independent code review findings fixed                     |
| Unit test cases                                       | Unit tests for every service, validator, repository, store and helper; plus integration, OpenAPI contract and real-process end-to-end tests ([TESTING.md](TESTING.md))                                     |
| Coverage of edge cases                                | See [use cases](#use-cases-covered): rounding, tiny amounts, 100-stock portfolios, time-zone and DST boundaries, concurrency, retries, malformed input                                                     |
| Error handling                                        | One error format with stable codes and actionable messages, client errors never become 500s, process-level fatal handling (`error-messages.test.ts`, `process-handlers.test.ts`, `server-process.test.ts`) |
| Navigating ambiguity, documenting assumptions         | Decisions recorded in the README › Assumptions and [ANSWERS.md](../ANSWERS.md) › 2                                                                                                                         |

## Use cases covered

### A. Placing orders

| ID     | Use case                                                                  | Expected outcome                                               | Test                                                                                               |
| ------ | ------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| UC-A1  | The brief's example, default price                                        | 201; $60.00 / $40.00; 0.600 / 0.400 shares                     | `orders.test.ts › creates the brief example…`                                                      |
| UC-A2  | Partner sends a market price for every stock                              | Partner prices used, `priceSource: PARTNER`                    | `order-calculator.service.test.ts › uses the partner price where supplied…`                        |
| UC-A3  | Partner prices for some stocks only                                       | Mixed `PARTNER` / `DEFAULT` per line                           | `orders.test.ts › uses partner market prices over the default`                                     |
| UC-A4  | SELL order                                                                | Same split and quantities as BUY                               | `orders.test.ts › creates SELL orders`                                                             |
| UC-A5  | Quantity precision 0, 3 and 7                                             | Quantities rounded down to the configured places               | `quantity-calculator.test.ts › respects a precision of 7…`, `› …of 0…`                             |
| UC-A6  | Amount that does not split into whole cents (33.3333 / 33.3333 / 33.3334) | 33.33 + 33.33 + 33.34; totals exact                            | `order-calculator.service.test.ts › keeps the totals consistent for an uneven three-way split`     |
| UC-A7  | 100 stocks at 1% with leftover cents ($199.99)                            | Leftover cents spread; every line within one cent of its share | `amount-splitter.test.ts › spreads leftover cents instead of piling them onto one line`            |
| UC-A8  | Single-stock portfolio                                                    | Whole amount to one line                                       | `order.validator.test.ts › accepts a single-stock portfolio at 100%`                               |
| UC-A9  | Decimals sent as JSON numbers instead of strings                          | Accepted and converted exactly                                 | `order.validator.test.ts › accepts JSON numbers as well as decimal strings`                        |
| UC-A10 | Lower-case or padded symbols                                              | Normalised to upper case                                       | `order.validator.test.ts › normalises symbols to upper case…`                                      |
| UC-A11 | Low-priced stock with a 4-decimal price                                   | Price precision kept in the response                           | `order-calculator.service.test.ts › keeps extra price precision in the output`                     |
| UC-A12 | One stock too small to buy any shares                                     | 201 with quantity 0 for that line and a warning                | `error-messages.test.ts › an order where only some stocks are too small is accepted with warnings` |
| UC-A13 | Order too small for any stock to trade                                    | 422 `ORDER_NOT_EXECUTABLE`, reasons per stock, not stored      | `error-messages.test.ts › order too small to trade anything…`, `› is not stored or listed`         |
| UC-A14 | Rounding never overspends                                                 | Quantity rounded down; value ≤ amount; residual reported       | `quantity-calculator.test.ts › rounds DOWN, never up…`, `› reports residual cash…`                 |

### B. When the order executes

| ID    | Use case                                       | Expected outcome                      | Test                                                                                        |
| ----- | ---------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| UC-B1 | Weekday before 09:30 New York                  | Today at 09:30 (`BEFORE_MARKET_OPEN`) | `market-scheduler.service.test.ts › before open -> same day at open`                        |
| UC-B2 | Weekday during market hours                    | Immediately (`MARKET_OPEN`)           | `› during market hours -> immediately…`, `› exactly at open…`, `› one minute before close…` |
| UC-B3 | Weekday at or after 16:00, each weekday        | Next weekday 09:30; Friday → Monday   | `› exactly at close…`, `› %s after close -> next weekday at open`                           |
| UC-B4 | Saturday or Sunday                             | Monday 09:30 (`WEEKEND`)              | `› %s -> Monday at open`                                                                    |
| UC-B5 | Saturday in UTC but Friday evening in New York | Decided in New York time              | `› Saturday in UTC but still Friday evening in New York…`                                   |
| UC-B6 | Request from India in the evening              | Before the New York open              | `› evening in India is before the New York open`                                            |
| UC-B7 | Daylight-saving changes (both directions)      | Correct offset (−05:00 / −04:00)      | `› Friday before DST starts…`, `› Friday before DST ends…`                                  |
| UC-B8 | A different configured market (London)         | Uses that market's hours and zone     | `› works for other configured markets`                                                      |

### C. Order history

| ID    | Use case                               | Expected outcome                             | Test                                                                                          |
| ----- | -------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| UC-C1 | No orders yet                          | 200 with empty list                          | `orders.test.ts › returns an empty list when there are no orders`                             |
| UC-C2 | Several orders, paging and type filter | Newest first; `limit`/`offset`; total        | `orders.test.ts › returns history newest first…`                                              |
| UC-C3 | Get one order by id                    | 200 with the stored order                    | `orders.test.ts › returns a stored order`                                                     |
| UC-C4 | Unknown or malformed order id          | 404 / 400 with a clear message               | `orders.test.ts › returns 404 for an unknown order`, `› returns 400 for a malformed order id` |
| UC-C5 | Another partner's order                | 404 (never revealed) and excluded from lists | `auth.test.ts › keeps each partner's orders private`                                          |
| UC-C6 | Application restarts                   | History is empty                             | `orders.test.ts › data does not survive a restart…`                                           |

### D. Invalid requests

| ID    | Use case                                                         | Expected outcome                                            | Test                                                                            |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| UC-D1 | Missing fields, wrong types, unsupported `orderType` or currency | 400 `VALIDATION_ERROR`, every problem listed with its field | `order.validator.test.ts`; `error-messages.test.ts › field validation`          |
| UC-D2 | Allocations not adding up to 100                                 | 400 with the gap ("10 short" / "10.5 over")                 | `error-messages.test.ts › allocations over 100: says by how much`               |
| UC-D3 | Duplicate symbols (any letter case)                              | 400 pointing at both entries                                | `error-messages.test.ts › duplicate symbol…`                                    |
| UC-D4 | Zero, negative or malformed amount or partner price              | 400; invalid partner price never replaced by $100           | `order.validator.test.ts › rejects an invalid supplied marketPrice…`            |
| UC-D5 | Typo in a field name (`markePrice`)                              | 400 naming the unknown field and the allowed ones           | `error-messages.test.ts › unknown field: names it and lists the allowed fields` |
| UC-D6 | Malformed JSON, empty body, oversized body, wrong `Content-Type` | 400 / 413 / 415 with specific messages                      | `error-messages.test.ts › request body format`                                  |
| UC-D7 | Corrupt compressed body                                          | 400, never 500                                              | `error-messages.test.ts › corrupt compressed body…`                             |
| UC-D8 | `__proto__` / `constructor` payloads                             | Rejected; no prototype pollution                            | `hardening.test.ts › rejects a top-level __proto__ key`                         |
| UC-D9 | Wrong HTTP method                                                | 405 with `Allow`                                            | `hardening.test.ts`; `error-messages.test.ts › wrong method…`                   |

### E. Retries and duplicates

| ID    | Use case                                        | Expected outcome                            | Test                                                                      |
| ----- | ----------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| UC-E1 | Partner retries with the same `Idempotency-Key` | Original response replayed; no second order | `idempotency.test.ts › replays the original response…`                    |
| UC-E2 | Same key, different body                        | 422 `IDEMPOTENCY_KEY_REUSED`                | `idempotency.test.ts › rejects reusing a key with a different body (422)` |
| UC-E3 | Retry while the first request is still running  | 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`       | `idempotency.test.ts › returns 409 while the first request…`              |
| UC-E4 | First attempt failed validation                 | Key can be reused after fixing the body     | `idempotency.test.ts › does not store failed requests…`                   |
| UC-E5 | No key sent                                     | Each request creates an order               | `idempotency.test.ts › creates separate orders when no key is sent`       |

### F. Access and abuse

| ID    | Use case                                         | Expected outcome                                     | Test                                                                                                          |
| ----- | ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| UC-F1 | Missing or wrong API key                         | 401 (missing vs invalid explained)                   | `auth.test.ts › rejects requests without an API key`; `error-messages.test.ts › key %p -> %s`                 |
| UC-F2 | Key rotation (two keys for one partner)          | Both work                                            | `auth.test.ts › supports several keys per partner (key rotation)`                                             |
| UC-F3 | Too many requests from one IP, or one partner    | 429 with `Retry-After`                               | `rate-limit.test.ts`                                                                                          |
| UC-F4 | Anonymous client sends junk bodies               | 401 and counted by the rate limit; body never parsed | `rate-limit.test.ts › unauthenticated malformed bodies get 401…`                                              |
| UC-F5 | Server started without authentication configured | Refuses to start with a clear hint                   | `server-process.test.ts › refuses to start when authentication is neither configured nor explicitly disabled` |

### G. Operations

| ID    | Use case                                    | Expected outcome                                                                         | Test                                                                          |
| ----- | ------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| UC-G1 | Every request                               | One log line with `durationMs`, route template, status and request id; no bodies or keys | `orders.test.ts › observability`                                              |
| UC-G2 | Orchestrator health probes                  | `/health/live` and `/health/ready`                                                       | `health.test.ts`                                                              |
| UC-G3 | Graceful shutdown (SIGTERM)                 | Readiness 503, in-flight requests finish, exit 0                                         | `server-process.test.ts › starts, serves requests and shuts down gracefully…` |
| UC-G4 | Port already in use / invalid configuration | Clear fatal message, exit 1                                                              | `server-process.test.ts › exits with code 1…`                                 |
| UC-G5 | Unhandled rejection or uncaught exception   | Structured fatal log, drain, exit 1                                                      | `process-handlers.test.ts`                                                    |
| UC-G6 | Storage failure during a request            | Generic 500, details only in logs                                                        | `orders.test.ts › returns a generic 500 without leaking internals…`           |

## Deliberately out of scope

These are documented decisions, not gaps (see README › Assumptions and
[ANSWERS.md](../ANSWERS.md) › 2 and 4):

| Not covered                 | Why                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Public holidays             | The brief says only Monday–Friday; the scheduler is behind an interface so an exchange calendar can replace it |
| Checking holdings for SELL  | Holdings are not part of the input                                                                             |
| Sending orders to a broker  | The brief asks when to execute, not to execute; orders are `SCHEDULED`                                         |
| Live market prices          | The brief fixes the price at $100 unless the partner supplies one                                              |
| Currencies other than USD   | The fixed $100 price is a USD price                                                                            |
| Persistence across restarts | The brief requires that data does not survive a restart                                                        |
