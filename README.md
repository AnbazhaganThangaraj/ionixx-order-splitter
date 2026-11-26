# Ionixx Order Splitter

[![CI](https://github.com/AnbazhaganThangaraj/ionixx-order-splitter/actions/workflows/ci.yml/badge.svg)](https://github.com/AnbazhaganThangaraj/ionixx-order-splitter/actions/workflows/ci.yml)

A REST API for a robo-advisor's model-portfolio offering. A partner sends a user's model
portfolio and a total amount to **buy or sell**; the API returns the **amount and number of
shares** for each stock, **when** the orders should execute (markets open Monday–Friday),
and the **history** of orders. Node.js + TypeScript + Express; data lives in memory and does
not survive a restart, as the brief requires.

| Document                                       | Contents                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| [Request examples](#request-examples)          | curl examples: BUY, SELL, price override, retries, history, error cases    |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)   | Every requirement in the brief traced to code and tests; use cases covered |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)   | HLD and LLD diagrams: context, layers, request pipeline, sequence, classes |
| [docs/API.md](docs/API.md)                     | Full API reference: fields, responses, idempotency, errors                 |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable, authentication setup                           |
| [docs/PRODUCTION.md](docs/PRODUCTION.md)       | Middleware pipeline, security and operational controls, CI                 |
| [SECURITY.md](SECURITY.md)                     | Threat model (STRIDE), API key management, audit events                    |
| [docs/TESTING.md](docs/TESTING.md)             | Test layers and coverage                                                   |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)     | Load-test method, results and findings                                     |

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

Monetary values and quantities are decimal strings (JSON numbers are accepted too). Every
response time is logged to the console in milliseconds (`durationMs`). Field-by-field
reference: [docs/API.md](docs/API.md).

## Request examples

Every example below was run against a local server started with the quick-start
settings (`cp .env.example .env`, so authentication is off); the responses are real
output. Ids, timestamps and `executeAt` will differ when you run them. The same requests
can be tried interactively in Swagger UI at <http://localhost:3000/docs>.

| #   | Scenario                                                                                    | Status                            |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | [BUY: the brief's example](#1-buy-the-briefs-example)                                       | 201                               |
| 2   | [SELL](#2-sell)                                                                             | 201                               |
| 3   | [Partner market price overrides the default](#3-partner-market-price-overrides-the-default) | 201                               |
| 4   | [Safe retries with `Idempotency-Key`](#4-safe-retries-with-idempotency-key)                 | 201 / 422                         |
| 5   | [Order history](#5-order-history)                                                           | 200                               |
| 6   | [Error cases](#6-error-cases)                                                               | 400 / 401 / 404 / 405 / 415 / 422 |

### 1. BUY: the brief's example

#### USD 100 into AAPL 60% / TSLA 40% at the default $100 price

Each stock gets its share of the amount, and the quantity is that amount divided by the
price, rounded down to `QUANTITY_PRECISION` (3) decimal places.

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"100","portfolio":[{"symbol":"AAPL","allocation":"60"},{"symbol":"TSLA","allocation":"40"}]}'
```

Response: `201`

```json
{
  "orderId": "d6cd6c41-c34a-4db7-8430-4ffaa9752d6e",
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
  "totals": {
    "allocatedAmount": "100.00",
    "estimatedValue": "100.00",
    "residualAmount": "0.00"
  },
  "execution": {
    "executeAt": "2026-11-26T09:30:00.000-05:00",
    "timeZone": "America/New_York",
    "reason": "BEFORE_MARKET_OPEN"
  },
  "warnings": [],
  "createdAt": "2026-11-26T07:53:50.164Z"
}
```

### 2. SELL

#### Sell USD 250 across three stocks

SELL uses the same value-based split as BUY: the amount is the value to sell.

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"SELL","totalAmount":"250","portfolio":[{"symbol":"AAPL","allocation":"50"},{"symbol":"MSFT","allocation":"30"},{"symbol":"GOOGL","allocation":"20"}]}'
```

<details>
<summary>Response: <code>201</code></summary>

```json
{
  "orderId": "010573d2-45a7-4c89-b256-8d535db25d41",
  "partnerId": "anonymous",
  "orderType": "SELL",
  "status": "SCHEDULED",
  "currency": "USD",
  "totalAmount": "250.00",
  "quantityPrecision": 3,
  "lines": [
    {
      "symbol": "AAPL",
      "allocationPercent": "50",
      "allocatedAmount": "125.00",
      "price": "100.00",
      "priceSource": "DEFAULT",
      "quantity": "1.250",
      "estimatedValue": "125.00",
      "residualAmount": "0.00"
    },
    {
      "symbol": "MSFT",
      "allocationPercent": "30",
      "allocatedAmount": "75.00",
      "price": "100.00",
      "priceSource": "DEFAULT",
      "quantity": "0.750",
      "estimatedValue": "75.00",
      "residualAmount": "0.00"
    },
    {
      "symbol": "GOOGL",
      "allocationPercent": "20",
      "allocatedAmount": "50.00",
      "price": "100.00",
      "priceSource": "DEFAULT",
      "quantity": "0.500",
      "estimatedValue": "50.00",
      "residualAmount": "0.00"
    }
  ],
  "totals": {
    "allocatedAmount": "250.00",
    "estimatedValue": "250.00",
    "residualAmount": "0.00"
  },
  "execution": {
    "executeAt": "2026-11-26T09:30:00.000-05:00",
    "timeZone": "America/New_York",
    "reason": "BEFORE_MARKET_OPEN"
  },
  "warnings": [],
  "createdAt": "2026-11-26T07:53:50.174Z"
}
```

</details>

### 3. Partner market price overrides the default

#### AAPL at the partner's price, TSLA at the default

`marketPrice` is optional per stock. Where it is sent it takes priority (`priceSource:
"PARTNER"`); otherwise the default $100 is used (`"DEFAULT"`). 600 / 187.43 = 3.2012…,
rounded down to 3.201 shares, so 0.04 is reported as residual cash rather than overspent.

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"1000","portfolio":[{"symbol":"AAPL","allocation":"60","marketPrice":"187.43"},{"symbol":"TSLA","allocation":"40"}]}'
```

<details>
<summary>Response: <code>201</code></summary>

```json
{
  "orderId": "25d8b7b1-4e14-4a90-b27b-2260ce33b304",
  "partnerId": "anonymous",
  "orderType": "BUY",
  "status": "SCHEDULED",
  "currency": "USD",
  "totalAmount": "1000.00",
  "quantityPrecision": 3,
  "lines": [
    {
      "symbol": "AAPL",
      "allocationPercent": "60",
      "allocatedAmount": "600.00",
      "price": "187.43",
      "priceSource": "PARTNER",
      "quantity": "3.201",
      "estimatedValue": "599.96",
      "residualAmount": "0.04"
    },
    {
      "symbol": "TSLA",
      "allocationPercent": "40",
      "allocatedAmount": "400.00",
      "price": "100.00",
      "priceSource": "DEFAULT",
      "quantity": "4.000",
      "estimatedValue": "400.00",
      "residualAmount": "0.00"
    }
  ],
  "totals": {
    "allocatedAmount": "1000.00",
    "estimatedValue": "999.96",
    "residualAmount": "0.04"
  },
  "execution": {
    "executeAt": "2026-11-26T09:30:00.000-05:00",
    "timeZone": "America/New_York",
    "reason": "BEFORE_MARKET_OPEN"
  },
  "warnings": [],
  "createdAt": "2026-11-26T07:53:50.180Z"
}
```

</details>

### 4. Safe retries with `Idempotency-Key`

#### Sending the same request twice creates one order

If a partner's request times out it can resend it with the same key. The first call
creates the order; a repeat returns the stored response with the header
`Idempotent-Replayed: true` instead of creating a second order.

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Idempotency-Key: order-1001' \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"100","portfolio":[{"symbol":"AAPL","allocation":"100"}]}'
```

Both calls return `201` with the same `orderId`
(`ceb06b40-ac60-45aa-a761-e0145f18fa3f`); the second also has
`Idempotent-Replayed: true`.

#### Reusing the key with a different body is rejected

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Idempotency-Key: order-1001' \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"200","portfolio":[{"symbol":"AAPL","allocation":"100"}]}'
```

Response: `422`

```json
{
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "This Idempotency-Key was already used with a different request body; use a new key for a new request, or resend the original body to get the original response",
    "details": []
  },
  "requestId": "034db489-b16b-46b3-a334-88aff8b2930d"
}
```

### 5. Order history

#### List orders, newest first, with paging and a type filter

`limit` (1–100, default 20), `offset` (default 0) and `orderType` (`BUY` or `SELL`) are
optional. `pagination.total` is the number of matching orders. Orders are
shortened below with [`jq`](https://jqlang.org) (drop the `| jq …` part if you don't have
it); the real response has every field shown in example 1.

```bash
curl -s 'http://localhost:3000/api/v1/orders?limit=2&offset=0&orderType=BUY' \
  | jq '{data: [.data[] | {orderId, orderType, totalAmount, status, createdAt}], pagination}'
```

Response: `200`

```json
{
  "data": [
    {
      "orderId": "ceb06b40-ac60-45aa-a761-e0145f18fa3f",
      "orderType": "BUY",
      "status": "SCHEDULED",
      "totalAmount": "100.00",
      "createdAt": "2026-11-26T07:53:50.186Z"
    },
    {
      "orderId": "25d8b7b1-4e14-4a90-b27b-2260ce33b304",
      "orderType": "BUY",
      "status": "SCHEDULED",
      "totalAmount": "1000.00",
      "createdAt": "2026-11-26T07:53:50.180Z"
    }
  ],
  "pagination": {
    "limit": 2,
    "offset": 0,
    "total": 3
  }
}
```

#### Get one order by id

Use an `orderId` returned when the order was created (here, the order from example 1).

```bash
curl -s http://localhost:3000/api/v1/orders/d6cd6c41-c34a-4db7-8430-4ffaa9752d6e
```

<details>
<summary>Response: <code>200</code></summary>

```json
{
  "orderId": "d6cd6c41-c34a-4db7-8430-4ffaa9752d6e",
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
  "totals": {
    "allocatedAmount": "100.00",
    "estimatedValue": "100.00",
    "residualAmount": "0.00"
  },
  "execution": {
    "executeAt": "2026-11-26T09:30:00.000-05:00",
    "timeZone": "America/New_York",
    "reason": "BEFORE_MARKET_OPEN"
  },
  "warnings": [],
  "createdAt": "2026-11-26T07:53:50.164Z"
}
```

</details>

### 6. Error cases

Every error has the same shape: a stable `code`, a `message` that says how to fix the
request, `details` per field, and a `requestId` that matches the server log line.

#### Allocations do not add up to 100 → 400

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"100","portfolio":[{"symbol":"AAPL","allocation":"60"},{"symbol":"TSLA","allocation":"30"}]}'
```

Response: `400`

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed: 1 problem found (see details)",
    "details": [
      {
        "path": "portfolio",
        "message": "allocations must add up to exactly 100 (got 90, 10 short)"
      }
    ]
  },
  "requestId": "eeffba5c-c3d7-4eba-9904-708b257eff5f"
}
```

#### Several invalid fields → 400, every problem listed

Unsupported order type, negative amount and a zero partner price, reported together.

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"HOLD","totalAmount":"-50","portfolio":[{"symbol":"AAPL","allocation":"100","marketPrice":"0"}]}'
```

Response: `400`

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed: 3 problems found (see details)",
    "details": [
      {
        "path": "orderType",
        "message": "must be one of BUY, SELL (got \"HOLD\")"
      },
      {
        "path": "totalAmount",
        "message": "must be a positive decimal number such as \"100.50\" (got \"-50\"; no signs, exponents, commas or spaces)"
      },
      {
        "path": "portfolio[0].marketPrice",
        "message": "must be greater than 0"
      }
    ]
  },
  "requestId": "77e32218-af37-469b-b222-c750be4c47b8"
}
```

#### Duplicate symbol (any letter case) → 400

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"100","portfolio":[{"symbol":"AAPL","allocation":"50"},{"symbol":"aapl","allocation":"50"}]}'
```

Response: `400`

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed: 1 problem found (see details)",
    "details": [
      {
        "path": "portfolio[1].symbol",
        "message": "duplicate symbol \"AAPL\" (already at portfolio[0]); combine them into one entry"
      }
    ]
  },
  "requestId": "28b5993c-806c-482f-8c4f-94c26fcb6809"
}
```

#### Misspelled field name → 400

A typo such as `markePrice` is rejected instead of being silently ignored (which would
have used the $100 default).

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"100","portfolio":[{"symbol":"AAPL","allocation":"100","markePrice":"150"}]}'
```

Response: `400`

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed: 1 problem found (see details)",
    "details": [
      {
        "path": "portfolio[0]",
        "message": "unknown field(s): markePrice; allowed fields: symbol, allocation, marketPrice"
      }
    ]
  },
  "requestId": "28181d05-3dfa-4041-8954-b46a3af385e9"
}
```

#### Amount too small to buy any shares → 422

The request is valid but would trade nothing, so no order is created.

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"0.01","portfolio":[{"symbol":"AAPL","allocation":"50","marketPrice":"5000"},{"symbol":"TSLA","allocation":"50","marketPrice":"5000"}]}'
```

Response: `422`

```json
{
  "error": {
    "code": "ORDER_NOT_EXECUTABLE",
    "message": "Order would not trade anything: no stock receives enough of totalAmount to buy the smallest allowed quantity (3 decimal places). Increase totalAmount.",
    "details": [
      {
        "path": "portfolio[0]",
        "message": "AAPL: allocated amount 0.01 is too small to trade any shares at 5000.00 with 3 decimal places; the full amount is reported as residual cash"
      },
      {
        "path": "portfolio[1]",
        "message": "TSLA: allocated amount 0.00 is too small to trade any shares at 5000.00 with 3 decimal places; the full amount is reported as residual cash"
      }
    ]
  },
  "requestId": "2d0130b7-ef3f-4995-8bf4-111db66a80ed"
}
```

#### One stock too small → 201 with a warning

If at least one stock trades, the order is created; the stock that cannot trade gets
quantity 0, its amount is residual cash, and `warnings` explains why.

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY","totalAmount":"10","portfolio":[{"symbol":"AAPL","allocation":"99.9"},{"symbol":"TSLA","allocation":"0.1","marketPrice":"5000"}]}'
```

<details>
<summary>Response: <code>201</code></summary>

```json
{
  "orderId": "996f866b-04cd-4c70-a2e1-3bb8870c981d",
  "partnerId": "anonymous",
  "orderType": "BUY",
  "status": "SCHEDULED",
  "currency": "USD",
  "totalAmount": "10.00",
  "quantityPrecision": 3,
  "lines": [
    {
      "symbol": "AAPL",
      "allocationPercent": "99.9",
      "allocatedAmount": "9.99",
      "price": "100.00",
      "priceSource": "DEFAULT",
      "quantity": "0.099",
      "estimatedValue": "9.90",
      "residualAmount": "0.09"
    },
    {
      "symbol": "TSLA",
      "allocationPercent": "0.1",
      "allocatedAmount": "0.01",
      "price": "5000.00",
      "priceSource": "PARTNER",
      "quantity": "0.000",
      "estimatedValue": "0.00",
      "residualAmount": "0.01"
    }
  ],
  "totals": {
    "allocatedAmount": "10.00",
    "estimatedValue": "9.90",
    "residualAmount": "0.10"
  },
  "execution": {
    "executeAt": "2026-11-26T09:30:00.000-05:00",
    "timeZone": "America/New_York",
    "reason": "BEFORE_MARKET_OPEN"
  },
  "warnings": [
    "TSLA: allocated amount 0.01 is too small to trade any shares at 5000.00 with 3 decimal places; the full amount is reported as residual cash"
  ],
  "createdAt": "2026-11-26T07:53:50.249Z"
}
```

</details>

#### Malformed JSON → 400

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderType":"BUY",'
```

Response: `400`

```json
{
  "error": {
    "code": "INVALID_JSON",
    "message": "Request body is not valid JSON; send a JSON object",
    "details": [
      {
        "path": "body",
        "message": "Expected double-quoted property name in JSON at position 19 (line 1 column 20)"
      }
    ]
  },
  "requestId": "453faf16-72fa-41b4-8a15-8c8a5ae327d3"
}
```

#### Wrong Content-Type → 415

```bash
curl -s -X POST http://localhost:3000/api/v1/orders \
  -H 'Content-Type: text/plain' \
  -d 'hello'
```

Response: `415`

```json
{
  "error": {
    "code": "UNSUPPORTED_MEDIA_TYPE",
    "message": "Content-Type must be application/json (got \"text/plain\")",
    "details": []
  },
  "requestId": "c2435561-26e5-4b37-b5ad-916cd033e2dd"
}
```

#### Unknown order id → 404

```bash
curl -s http://localhost:3000/api/v1/orders/3f8e1c52-0000-4000-8000-000000000000
```

Response: `404`

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Order 3f8e1c52-0000-4000-8000-000000000000 not found",
    "details": []
  },
  "requestId": "bb349e98-1a1e-4e55-bbd0-20a981ba330c"
}
```

#### Malformed order id → 400

```bash
curl -s http://localhost:3000/api/v1/orders/not-a-uuid
```

Response: `400`

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed: 1 problem found (see details)",
    "details": [
      {
        "path": "orderId",
        "message": "must be a valid order id (UUID), as returned when the order was created"
      }
    ]
  },
  "requestId": "84c4f636-369d-44fd-a635-f95f8ceafe2b"
}
```

#### Invalid history query → 400

```bash
curl -s 'http://localhost:3000/api/v1/orders?limit=500&orderType=HOLD'
```

Response: `400`

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed: 2 problems found (see details)",
    "details": [
      {
        "path": "limit",
        "message": "must be an integer from 1 to 100"
      },
      {
        "path": "orderType",
        "message": "must be one of BUY, SELL (got \"HOLD\")"
      }
    ]
  },
  "requestId": "47f1536a-275e-4f45-9f16-cbefc38e8709"
}
```

#### Unsupported method → 405

The response also carries an `Allow` header.

```bash
curl -s -X DELETE http://localhost:3000/api/v1/orders
```

Response: `405`

```json
{
  "error": {
    "code": "METHOD_NOT_ALLOWED",
    "message": "Method DELETE is not allowed on /api/v1/orders; allowed: GET, POST, HEAD, OPTIONS",
    "details": []
  },
  "requestId": "a0b06100-6ce1-4318-b7f5-a014a7ff00f3"
}
```

#### Missing or wrong API key → 401

Only when authentication is on (production, or `AUTH_DISABLED=false` with keys set). To
try it locally, start a second instance with a development key:

```bash
AUTH_DISABLED=false API_KEYS='partner-a:local-dev-key-not-a-secret' PORT=3001 npm start
```

```bash
curl -s http://localhost:3001/api/v1/orders
```

Response: `401`

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "API key is missing: send your key in the X-API-Key header",
    "details": []
  },
  "requestId": "26b8ea31-3c5f-4932-bb93-5af0a6d9d327"
}
```

```bash
curl -s http://localhost:3001/api/v1/orders -H 'X-API-Key: wrong-key'
```

Response: `401`

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "API key is invalid: check the X-API-Key header value",
    "details": []
  },
  "requestId": "5079276b-1df4-4ed7-9389-f195a0af2e12"
}
```

With the right key (`-H 'X-API-Key: local-dev-key-not-a-secret'`) the same
request returns `200`. Rate-limit (`429`) and other responses are described in
[docs/API.md](docs/API.md).

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
Diagrams (HLD and LLD) are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
