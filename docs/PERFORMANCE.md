# Performance

The brief says performance is important. This document covers how response times are
instrumented, how the API was load-tested, the results, what the tests found and fixed,
and the limits of these numbers.

## Instrumentation in the running service

Every request logs one structured line with its duration, measured with a monotonic
clock (`performance.now()`), so response times are visible in the console as the brief
requires:

```json
{
  "method": "POST",
  "route": "/api/v1/orders",
  "statusCode": 201,
  "durationMs": 0.84,
  "msg": "POST /api/v1/orders 201 0.84ms"
}
```

Because these are JSON lines with the route template (`/api/v1/orders/:orderId`, not the
concrete id), they can be aggregated into latency percentiles per endpoint by any log
platform.

## How the load test works

```bash
npm run build
npm run perf                                   # 50 concurrent connections, 8 s per scenario
PERF_CONNECTIONS=1 PERF_DURATION=4 npm run perf # single-client latency
```

`perf/load-test.ts` starts the **compiled server in production mode** (authentication on,
logging at `info` so its cost is included, output discarded), then drives each scenario
with [autocannon](https://github.com/mcollina/autocannon). Rate limits are raised for the
test so they do not cap the measurement. Results are written to `perf/results/*.json`.

| Scenario                                 | What it exercises                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /health/live`                       | Baseline: HTTP stack and middleware only                                      |
| `POST /orders`, 2 / 10 / 100 stocks      | Full create path: auth, validation, decimal maths, scheduling, storage, audit |
| `POST /orders`, idempotent replay        | Same `Idempotency-Key` every time (answered from the store)                   |
| `POST /orders`, unique `Idempotency-Key` | A new key per request (claim + store path)                                    |
| `GET /orders/{id}`                       | Lookup by id with partner check                                               |
| `GET /orders?limit=20`                   | History page, measured with **~176,000 orders** in memory                     |

Orders accumulate across scenarios (nothing is reset), so later scenarios run against a
large history: a deliberately pessimistic setup for the in-memory store.

**Environment:** Linux VM, 4 vCPUs, 4 GB RAM, Node.js 22.23.5. The load generator runs on
the **same machine** and competes for the same CPUs, so these figures understate what the
service can do on dedicated hardware. Numbers are from one run (`perf/results/`); expect
some variation between runs.

## Results

### Single client (1 connection): what one request costs

Mean latency is derived from throughput (one connection, one request at a time), because
autocannon's percentiles have 1 ms resolution and every request here completes in under 1 ms.

| Scenario                                 | Requests/s | Mean latency |
| ---------------------------------------- | ---------: | -----------: |
| `GET /health/live`                       |     15,196 |      0.07 ms |
| `POST /orders`, 2 stocks                 |      6,839 |      0.15 ms |
| `POST /orders`, 10 stocks                |      5,175 |      0.19 ms |
| `POST /orders`, 100 stocks               |      1,343 |      0.74 ms |
| `POST /orders`, idempotent replay        |      8,744 |      0.11 ms |
| `POST /orders`, unique `Idempotency-Key` |      6,209 |      0.16 ms |
| `GET /orders/{id}`                       |     10,674 |      0.09 ms |
| `GET /orders?limit=20`                   |      5,804 |      0.17 ms |

### Under load (50 concurrent connections)

| Scenario                                     | Requests/s |   p50 |   p90 |   p99 | Errors / non-2xx |
| -------------------------------------------- | ---------: | ----: | ----: | ----: | ---------------: |
| `GET /health/live`                           |     19,332 |  2 ms |  2 ms |  4 ms |                0 |
| `POST /orders`, 2 stocks                     |      8,067 |  6 ms |  6 ms | 11 ms |                0 |
| `POST /orders`, 10 stocks                    |      5,731 |  8 ms |  9 ms | 16 ms |                0 |
| `POST /orders`, 100 stocks                   |      1,353 | 35 ms | 38 ms | 70 ms |                0 |
| `POST /orders`, idempotent replay            |     10,172 |  4 ms |  6 ms |  9 ms |                0 |
| `POST /orders`, unique `Idempotency-Key`     |      6,847 |  7 ms |  8 ms | 14 ms |                0 |
| `GET /orders/{id}`                           |     11,195 |  3 ms |  5 ms |  8 ms |                0 |
| `GET /orders?limit=20` (~176k orders stored) |      5,873 |  8 ms | 10 ms | 16 ms |                0 |

No errors, timeouts or unexpected status codes in any scenario. Occasional maximums of
50–550 ms are garbage-collection pauses while the heap grows to hold ~176,000 orders.

## What the load test found, and what changed

The first run exposed two places where cost grew with the amount of stored data:

| Scenario                                      | Before                                  | After                                                   | Cause and fix                                                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /orders?limit=20` with ~146k–176k orders | 123 req/s, p50 268 ms, **p99 4,440 ms** | 5,873 req/s, p50 8 ms, **p99 16 ms** (≈ 48× throughput) | Every list call copied and reversed **all** orders to return 20. The repository now keeps an append-only id list per partner and per (partner, type), so a page is a slice from the end: O(page size), independent of history size. |
| `POST` with a unique `Idempotency-Key`        | 3,311 req/s, p99 30 ms                  | 6,847 req/s, p99 14 ms (≈ 2× throughput)                | Expired keys were swept by scanning **every** record on each request. All records share one TTL and are kept in insertion order, so the sweep now stops at the first unexpired record.                                              |

Both fixes are covered by the existing repository and idempotency tests plus new tests
for paging across partners and types at scale and for expiry order. Full before/after
data: `perf/results/before-optimisation.json` and `perf/results/concurrent-50.json`.

## Observations

- **Cost scales with portfolio size**, as expected: validation, decimal arithmetic and the
  response grow with the number of stocks. A maximum-size portfolio (100 stocks) costs
  ~0.75 ms; a typical 2–10 stock portfolio ~0.15–0.2 ms.
- **The idempotent replay is cheaper than a normal create**, because it skips the
  calculation and returns the stored response.
- **Memory grows without bound.** The process reached ~1.55 GB resident memory with
  ~176,000 orders (roughly 9 KB per order including V8 overhead and idempotency records).
  That is inherent to the brief's in-memory, no-persistence design and fine for a POC,
  but a long-running instance would eventually run out of memory. In production, orders
  belong in a database (PostgreSQL), which removes this limit; for a long-running POC a
  configurable cap on stored orders would be the stopgap.
- **One Node.js process uses one CPU core** for request handling. Throughput scales by
  running several processes (one per core, or several container replicas), which requires
  the shared order store, rate limits and idempotency records described in
  [PRODUCTION.md](PRODUCTION.md).

## Limits of these numbers

- Synthetic, single-machine test with no network latency, TLS or load balancer.
- One process, in-memory storage. With a database, `POST` and `GET` latency would be
  dominated by database round trips (typically 1–5 ms), not by this code.
- They are useful for **relative** comparisons (before/after a change, small vs large
  portfolio) and to show that the application code itself adds well under a millisecond
  per request. They are not a capacity guarantee for production hardware.
