# API reference

Interactive docs: `/docs` (Swagger UI) and `/docs/openapi.json`. Base path: `/api/v1`. All bodies are JSON. When API keys are configured, every `/api/v1`
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

## Create an order

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

## Safe retries with `Idempotency-Key`

If a partner's request times out, it cannot know whether the order was created.
Sending an `Idempotency-Key` header makes the retry safe:

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-1001' \
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

## List order history

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

## Get one order

```bash
curl -s http://localhost:3000/api/v1/orders/096eecb5-de2f-4469-be10-7490a1c222ac
```

## Errors

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

| Status | `code`                            | When                                                        | Example message                                                                           |
| ------ | --------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`                | A field, query parameter or path parameter is invalid       | `Request validation failed: 2 problems found (see details)`                               |
| 400    | `INVALID_JSON`                    | Body is not valid JSON (details give the position)          | `Request body is not valid JSON; send a JSON object`                                      |
| 400    | `BAD_REQUEST`                     | Body cannot be read, e.g. a corrupt gzip/br body            | `Request body could not be read: Decompression failed`                                    |
| 401    | `UNAUTHORIZED`                    | API key missing or wrong (when auth is enabled)             | `API key is missing: send your key in the X-API-Key header`                               |
| 404    | `NOT_FOUND`                       | Unknown order id (or another partner's), or unknown route   | `Order 3f2b… not found`                                                                   |
| 405    | `METHOD_NOT_ALLOWED`              | Known route, unsupported method (`Allow` header is set)     | `Method DELETE is not allowed on /api/v1/orders; allowed: GET, POST, HEAD, OPTIONS`       |
| 409    | `IDEMPOTENCY_REQUEST_IN_PROGRESS` | Same `Idempotency-Key` is still being processed             | `A request with this Idempotency-Key is still being processed; retry shortly`             |
| 413    | `PAYLOAD_TOO_LARGE`               | Body larger than 100 kb                                     | `Request body is too large (limit 100kb)`                                                 |
| 415    | `UNSUPPORTED_MEDIA_TYPE`          | Not JSON, or unsupported charset / `Content-Encoding`       | `Content-Type must be application/json (got "text/plain")`                                |
| 422    | `ORDER_NOT_EXECUTABLE`            | Every stock rounds down to zero shares: nothing would trade | `Order would not trade anything: … Increase totalAmount.`                                 |
| 422    | `IDEMPOTENCY_KEY_REUSED`          | `Idempotency-Key` reused with a different body              | `…; use a new key for a new request, or resend the original body…`                        |
| 429    | `RATE_LIMITED`                    | Too many requests from this IP (`Retry-After` is set)       | `Too many requests from this IP address (limit 100 per 1 min); retry in 42 s`             |
| 429    | `PARTNER_QUOTA_EXCEEDED`          | The partner's quota is used up (`Retry-After` is set)       | `Partner request quota exceeded (limit 600 per 1 min); retry in 42 s`                     |
| 500    | `INTERNAL_ERROR`                  | Unexpected failure; details are logged, never returned      | `An unexpected error occurred. Please retry later; … contact support with the requestId.` |

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

## Response times in the console

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
