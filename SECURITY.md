# Security

This document describes how the Ionixx Order Splitter protects partner data, the
threats it was designed against, and what remains to be done for a real production
deployment. It is a proof of concept; the controls below are implemented and tested
unless marked as a production step.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
"Report a vulnerability" (Security tab) rather than opening a public issue.

## What is protected

| Asset                   | Why it matters                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| Order data              | Investment instructions of the partner's end users (amounts, holdings, timing) |
| Partner API keys        | Anyone holding a key can create and read that partner's orders                 |
| Calculation correctness | Wrong amounts or quantities are a financial loss, not just a bug               |
| Availability            | Partners depend on the API to place orders on time                             |

## Who we defend against

- An **unauthenticated internet client** probing or flooding the API.
- An **authenticated partner** trying to read or affect another partner's orders, or
  sending malformed or excessive requests.
- Someone who obtains **configuration or logs** (e.g. a leaked environment dump).
- A **compromised dependency** or base image.

Trust boundaries: internet → load balancer (TLS termination) → application → stdout logs.

## Threats and controls (STRIDE)

| Threat                     | Example                                                                    | Controls in place                                                                                                                                                                                                                                                                                                  | Remaining risk / production step                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spoofing**               | Guessing or stealing an API key                                            | 256-bit random keys (`npm run hash-key`); only SHA-256 hashes stored (`API_KEY_HASHES`); constant-time comparison; per-IP rate limit runs **before** authentication; `auth.failed` audit events                                                                                                                    | Static bearer keys can be replayed if leaked → mTLS or OAuth2 client credentials, or HMAC-signed requests with timestamp and nonce; secrets manager with rotation |
| **Tampering**              | Malformed or crafted payloads; modified traffic                            | Strict Zod validation, unknown fields rejected (no silent defaults); `__proto__`/`constructor` payloads rejected (tested); exact decimal arithmetic; HSTS; idempotency keys bound to a hash of the body                                                                                                            | TLS is terminated at the load balancer, not in the app; no request signing                                                                                        |
| **Repudiation**            | A partner disputes having created an order                                 | `order.created` audit event with partner id and order id; request ids on every response and log line                                                                                                                                                                                                               | Logs go to stdout → ship to an append-only, retained log store                                                                                                    |
| **Information disclosure** | Reading another partner's orders; leaks via errors, logs or caches         | Partner id taken **only** from the API key, never from the request; another partner's order returns 404 (no id probing); generic 500s; request bodies and keys never logged, plus logger redaction; `Cache-Control: no-store`; `default-src 'none'` CSP                                                            | Data is held in memory (lost on restart by design) → encryption at rest once a database is added                                                                  |
| **Denial of service**      | Request floods, huge bodies, slow clients                                  | Per-IP and per-partner rate limits; 100 kb body limit; max 100 stocks per portfolio; server header/request timeouts; graceful draining                                                                                                                                                                             | Counters are per instance → shared store (Redis) or limits at the gateway; WAF / DDoS protection upstream                                                         |
| **Elevation of privilege** | Acting as another partner; exploiting a vulnerable dependency or container | Authorization by partner scoping in the repository; container runs as non-root with production dependencies only and no package managers; dependency install scripts are disabled in the image build (`npm ci --ignore-scripts`); CodeQL, Dependabot, `npm audit`, Trivy image scan and gitleaks secret scan in CI | Image signing and provenance (e.g. cosign, SLSA); read-only root filesystem and dropped capabilities at deploy time                                               |

## Not applicable (by design)

- **CSRF** — no cookies or browser sessions; authentication is an explicit header.
- **XSS** — the API returns JSON only, with `Content-Security-Policy: default-src 'none'`
  and `X-Content-Type-Options: nosniff`.
- **SQL injection** — there is no database; a future repository must use parameterised queries.
- **CORS** — intentionally not enabled: clients are partner servers, not browsers.

## API key management

1. Generate a key and its hash:

   ```bash
   npm run hash-key -- --generate partner-a
   ```

2. Give the **key** to the partner once, over a secure channel.
3. Configure only the **hash**: `API_KEY_HASHES="partner-a:<sha256-hex>"`.
4. **Rotate** by adding the new hash alongside the old one, letting the partner switch,
   then removing the old hash. Several keys per partner are supported for this reason.

SHA-256 (not bcrypt) is appropriate here because keys are 256-bit random values, not
human-chosen passwords, so they cannot be brute-forced from their hashes.
`API_KEYS` (plaintext) is accepted for local development only; the app logs a warning
if it is used in production, and refuses to start in production without any keys.

## Audit events

Security-relevant events are logged as structured lines tagged `"audit": true`:

| Event                  | When                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `auth.failed`          | Missing or invalid API key (`reason`, client IP, route)      |
| `rate_limit.exceeded`  | IP or partner limit reached (`scope`)                        |
| `order.created`        | An order was stored (order id, partner id, type, line count) |
| `idempotency.replayed` | A retry was answered from the stored response                |
| `idempotency.conflict` | Key reused with a different body, or while still in progress |

They never contain API keys, amounts or symbols.

## Production hardening backlog

- Partner authentication with mTLS or OAuth2 client credentials; keys in a secrets manager.
- PostgreSQL with least-privilege accounts, encryption at rest, backups; Redis (or the
  gateway) for shared rate-limit and idempotency state.
- API gateway with TLS, WAF and DDoS protection; per-partner business limits
  (maximum order value, daily volume) with anomaly alerts on audit events.
- Signed, minimal container images (distroless), read-only filesystem, dropped capabilities.
- Regular penetration testing and dependency review.
