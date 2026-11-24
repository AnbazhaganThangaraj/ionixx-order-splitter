# Production readiness

What this service adds beyond the brief to behave like a production API, and where its proof-of-concept limits are.

## Middleware pipeline

Every request passes through these layers, in this order (`src/app.ts`):

| #   | Middleware                      | Applies to     | Purpose                                                                       |
| --- | ------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| 1   | `apiSecurityHeaders()` (helmet) | all            | Strict CSP (`default-src 'none'`), HSTS, `nosniff`, frame protection          |
| 2   | `connectionDrain()`             | all            | Sends `Connection: close` while shutting down                                 |
| 3   | `requestId()`                   | all            | Reuses a safe `X-Request-Id` or creates one; echoed in the response           |
| 4   | `responseTimeLogger()`          | all            | Monotonic timer; one JSON log line per request with `durationMs`              |
| 5   | `recordMountPath()`             | each router    | Keeps the route name correct in logs, including error paths                   |
| 6   | `docsSecurityHeaders()`         | `/docs`        | Looser CSP so Swagger UI can load its own scripts and styles                  |
| 7   | `noStore()`                     | `/api/v1`      | `Cache-Control: no-store` for financial data                                  |
| 8   | `apiRateLimit()`                | `/api/v1`      | Per-IP limit (429 + `Retry-After`), before auth to slow key guessing          |
| 9   | `apiKeyAuth()`                  | `/api/v1`      | `X-API-Key` check against stored hashes (constant-time), sets the partner id  |
| 10  | `partnerRateLimit()`            | `/api/v1`      | Per-partner quota after authentication (429 `PARTNER_QUOTA_EXCEEDED`)         |
| 11  | `requireJson()`                 | `POST /orders` | 415 unless the body is declared as JSON                                       |
| 12  | `express.json({ limit })`       | `POST /orders` | Body parsing (100 kb limit), only **after** rate limiting and authentication  |
| 13  | `idempotency()`                 | `POST /orders` | `Idempotency-Key` replay / conflict handling                                  |
| 14  | `methodNotAllowed()`            | known paths    | 405 + `Allow` for unsupported methods; `OPTIONS` → 204                        |
| 15  | `notFound()`                    | unmatched      | 404 in the standard error format                                              |
| 16  | `errorHandler()`                | all errors     | One error format; domain errors mapped (404/422); others become a generic 500 |

There is no global body parser: an anonymous or throttled client cannot make the server
buffer and parse a request body.

## Security controls

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
[SECURITY.md](../SECURITY.md).

## Operations

- **Health probes:** `/health/live` (process up) and `/health/ready` (accepting traffic).
- **Graceful shutdown:** on `SIGTERM`, readiness turns 503, new connections are refused,
  idle keep-alive sockets are closed, in-flight requests finish; forced exit after 10 s.
- **Fail-fast configuration:** invalid settings, missing authentication configuration
  (unless `AUTH_DISABLED=true` outside production) or production without keys stop the
  process at startup with a clear message.
- **Container:** multi-stage `Dockerfile`; runtime image has production dependencies
  only, no package managers (npm/yarn removed), runs as the unprivileged `node` user,
  with a `HEALTHCHECK`.
- **CI** (`.github/workflows/ci.yml`): format check, lint, type-check, tests with
  coverage, build and production-dependency audit on Node 22 and 24; builds the image,
  smoke-tests it (startup without keys fails, 401 without a key, a real order) and scans
  it with Trivy; gitleaks scans the git history for secrets.
- **Security automation:** CodeQL static analysis (`codeql.yml`) on every push and weekly;
  Dependabot updates for npm packages, GitHub Actions and the Docker base image.

## What this POC still keeps in memory

Rate-limit counters, idempotency records and orders live in process memory, so they are
per instance and lost on restart. Running several instances needs a shared store
(PostgreSQL for orders, Redis for rate limits and idempotency) — each sits behind an
interface or middleware option, so the change is local.

Memory grows with every stored order (about 1.5 GB at ~176,000 orders, see
[PERFORMANCE.md](PERFORMANCE.md)). That follows from the brief's in-memory design; in
production the orders belong in a database.
