# Testing

```bash
npm test
npm run test:coverage   # coverage report in coverage/
```

## Coverage

![Jest coverage report: 99.25% statements, 89.47% branches, 99.28% functions, 99.34% lines](images/coverage-report.png)

Snapshot from 24 Nov 2026 (later commits add tests; run the command above for current
figures). Over 99% of statements, functions and lines were covered. The
uncovered branches are mostly defensive fallbacks: default values for settings that are
always present after validation, `??` guards in type-narrowing code, and request-reading
error types that Express does not produce in practice. Run `npm run test:coverage` and
open `coverage/lcov-report/index.html` to see the current report.

## What the tests cover

The tests focus on behaviour and edge cases:

- **Validation** – missing fields, wrong types, unsupported order types and currencies,
  allocations not summing to 100, duplicate symbols (any letter case), invalid partner
  prices, unknown fields, NaN/Infinity, decimal-place limits.
- **Calculation** – the brief's example, partner-price precedence, precision 0 / 3 / 7,
  rounding down, uneven splits, tiny amounts, residual cash, and invariants (lines
  always add up to the total, every line within one cent of its exact share, value never
  exceeds the amount).
- **Scheduler** – every weekday, exact open and close, weekends, dates that differ
  between UTC and New York, both daylight-saving transitions, a non-US market.
- **Order service** – orchestration with hand-written fakes (clock, id generator,
  scheduler, audit), rejection of orders that trade nothing, save failures.
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
