# Architecture

High-level design (HLD) shows the system and its main parts; low-level design (LLD) shows
how a request moves through the code and how the classes depend on each other. Diagrams
are written in [Mermaid](https://mermaid.js.org/) and render directly on GitHub. They
describe the code in `src/` as it is; the last section is a **proposed** production
target, not implemented here.

- [HLD 1 — System context](#hld-1--system-context)
- [HLD 2 — Components and layers](#hld-2--components-and-layers)
- [LLD 1 — Request pipeline](#lld-1--request-pipeline)
- [LLD 2 — Creating an order (sequence)](#lld-2--creating-an-order-sequence)
- [LLD 3 — Classes and interfaces](#lld-3--classes-and-interfaces)
- [LLD 4 — Order calculation](#lld-4--order-calculation)
- [LLD 5 — Execution time](#lld-5--execution-time)
- [LLD 6 — Error handling](#lld-6--error-handling)
- [Proposed production architecture](#proposed-production-architecture)

## HLD 1 — System context

A partner's backend calls the API over HTTPS. The service is a single Node.js process
with no external dependencies: state is in memory (the brief requires that data does not
survive a restart), and logs go to stdout.

```mermaid
flowchart LR
    partner["Partner backend<br/>(robo-advisor)"]
    reviewer["Developer / reviewer"]

    subgraph service["Order Splitter API (Node.js process)"]
        api["REST API<br/>/api/v1/orders"]
        health["Health probes<br/>/health/live, /health/ready"]
        docs["API docs<br/>/docs (Swagger UI)"]
        memory[("In-memory state<br/>orders, idempotency keys,<br/>rate-limit counters")]
    end

    env["Environment / .env<br/>validated on startup"]
    stdout["stdout<br/>JSON access logs + audit events"]
    orchestrator["Docker / Kubernetes"]

    partner -- "HTTPS + X-API-Key<br/>JSON" --> api
    reviewer --> docs
    orchestrator -- "probes, SIGTERM" --> health
    env --> service
    api --> memory
    service --> stdout
```

## HLD 2 — Components and layers

Business logic sits in the service layer and depends only on interfaces (ports). The
concrete implementations are created in one place, `src/app.ts` (the composition root),
so storage or scheduling can be replaced without touching the use cases.

```mermaid
flowchart TB
    subgraph http["HTTP layer (Express 5)"]
        mw["Middlewares<br/>security headers, request id, timing,<br/>rate limits, API-key auth, idempotency"]
        routes["Routes<br/>orders, health, docs"]
        ctrl["OrderController<br/>Zod validation -> domain command"]
        errs["Error handler<br/>AppError / DomainError -> JSON"]
    end

    subgraph app["Application layer"]
        svc["OrderService<br/>implements OrderUseCases"]
    end

    subgraph domain["Domain"]
        types["Commands, Order, enums"]
        derrors["Domain errors<br/>OrderNotFound, OrderNotExecutable"]
    end

    subgraph ports["Ports (interfaces)"]
        pcalc["PortfolioCalculator"]
        psched["MarketScheduler"]
        prepo["OrderRepository"]
        pidem["IdempotencyStore"]
        pclock["Clock / AuditLog"]
    end

    subgraph adapters["Implementations (POC)"]
        calc["OrderCalculator<br/>decimal.js"]
        sched["WeekdayMarketScheduler<br/>Luxon"]
        repo["InMemoryOrderRepository"]
        idem["InMemoryIdempotencyStore"]
        sys["systemClock / pino audit log"]
    end

    mw --> routes --> ctrl --> svc
    mw -. uses .-> pidem
    svc --> pcalc & psched & prepo & pclock
    svc --> types
    svc -. throws .-> derrors
    derrors -. mapped by .-> errs
    pcalc --> calc
    psched --> sched
    prepo --> repo
    pidem --> idem
    pclock --> sys
```

## LLD 1 — Request pipeline

Every request passes the global middlewares; `/api/v1/orders` adds the rate limits and
authentication. The body is parsed only on `POST`, **after** rate limiting and
authentication, so anonymous or throttled clients cannot make the server parse a body.
Any error at any step goes to the single error handler.

```mermaid
flowchart TD
    req([Request]) --> sec["apiSecurityHeaders<br/>helmet, strict CSP"]
    sec --> drain["connectionDrain<br/>Connection: close while shutting down"]
    drain --> rid["requestId<br/>X-Request-Id"]
    rid --> timer["responseTimeLogger<br/>start monotonic timer"]
    timer --> which{Path}

    which -- "/health/*" --> healthR["Health router"]
    which -- "/docs" --> docsR["Docs router<br/>looser CSP for Swagger UI"]
    which -- "/api/v1/orders" --> nostore["noStore<br/>Cache-Control: no-store"]
    which -- "anything else" --> nf["notFound -> 404"]

    nostore --> ipl{"apiRateLimit<br/>per IP"}
    ipl -- "over limit" --> e429a["429 RATE_LIMITED"]
    ipl -- ok --> auth{"apiKeyAuth<br/>X-API-Key vs SHA-256 hashes"}
    auth -- "missing / invalid" --> e401["401 UNAUTHORIZED"]
    auth -- "ok: partnerId" --> pql{"partnerRateLimit<br/>per partner"}
    pql -- "over quota" --> e429b["429 PARTNER_QUOTA_EXCEEDED"]
    pql -- ok --> method{Method}

    method -- GET --> getC["OrderController.list / getById"]
    method -- POST --> rj{"requireJson"}
    method -- other --> e405["405 + Allow"]
    rj -- "not JSON" --> e415["415 UNSUPPORTED_MEDIA_TYPE"]
    rj -- ok --> parse{"express.json<br/>100 kb limit"}
    parse -- "bad / too large" --> e400["400 INVALID_JSON / 413"]
    parse -- ok --> idem{"idempotency<br/>Idempotency-Key?"}
    idem -- "replay" --> replay["stored 201<br/>Idempotent-Replayed: true"]
    idem -- "conflict" --> e4xx["409 in progress / 422 reused"]
    idem -- "new or no key" --> create["OrderController.create"]

    e429a & e401 & e429b & e405 & e415 & e400 & e4xx & nf --> eh["errorHandler<br/>{ error: { code, message, details }, requestId }"]
    create & getC & replay & healthR & docsR & eh --> res([Response])
    res -. "finish / close" .-> log["access log line<br/>method, route, status, durationMs"]
```

## LLD 2 — Creating an order (sequence)

The happy path of `POST /api/v1/orders` with an `Idempotency-Key`, after the middlewares
above have authenticated the partner.

```mermaid
sequenceDiagram
    autonumber
    participant P as Partner
    participant MW as Middlewares
    participant I as Idempotency middleware
    participant IS as IdempotencyStore
    participant C as OrderController
    participant S as OrderService
    participant K as PortfolioCalculator
    participant M as MarketScheduler
    participant R as OrderRepository
    participant A as AuditLog

    P->>MW: POST /api/v1/orders + X-API-Key + Idempotency-Key
    MW->>MW: rate limits, authenticate (partnerId), parse JSON
    MW->>I: request
    I->>IS: begin(partnerId:key, sha256(body))
    IS-->>I: started
    I->>C: next()
    C->>C: parseOrThrow(createOrderSchema) -> CreateOrderCommand
    C->>S: createOrder(partnerId, command)
    S->>K: calculate(totalAmount, portfolio)
    K-->>S: lines, totals, warnings, untradableLines
    alt every line rounds down to zero shares
        S-->>C: throw OrderNotExecutableError
        C-->>P: 422 ORDER_NOT_EXECUTABLE (via error handler)
        I->>IS: release(key)
    else at least one line trades
        S->>M: nextExecution(clock.now())
        M-->>S: executeAt, timeZone, reason
        S->>R: save(order)
        S->>A: record("order.created", ids only)
        S-->>C: Order
        C-->>P: 201 Created + Location + order JSON
        I->>IS: complete(key, response) for replays
    end
    Note over MW,P: access log line with durationMs written when the response finishes
```

## LLD 3 — Classes and interfaces

The service and controller depend on interfaces, never on concrete classes, which is
what lets tests use simple hand-written fakes and lets a database or exchange calendar
replace the POC implementations.

```mermaid
classDiagram
    direction TB

    class OrderController {
        -service: OrderUseCases
        +create(req, res)
        +list(req, res)
        +getById(req, res)
    }
    class OrderUseCases {
        <<interface>>
        +createOrder(partnerId, command) Order
        +getOrder(partnerId, orderId) Order
        +listOrders(partnerId, query) OrderPage
    }
    class OrderService {
        -deps: OrderServiceDependencies
    }
    class PortfolioCalculator {
        <<interface>>
        +calculate(input) OrderCalculation
    }
    class OrderCalculator {
        -options: OrderCalculatorOptions
    }
    class MarketScheduler {
        <<interface>>
        +nextExecution(requestedAt) OrderExecution
    }
    class WeekdayMarketScheduler {
        -hours: MarketHours
    }
    class OrderRepository {
        <<interface>>
        +save(order)
        +findById(partnerId, orderId) Order
        +list(filter) OrderPage
    }
    class InMemoryOrderRepository {
        -orders: Map
        -idsByPartner: Map
        -idsByPartnerAndType: Map
    }
    class IdempotencyStore {
        <<interface>>
        +begin(scope, requestHash) BeginResult
        +complete(scope, response)
        +release(scope)
    }
    class InMemoryIdempotencyStore {
        -records: Map
    }
    class Clock {
        <<interface>>
        +now() Date
    }
    class AuditLog {
        <<interface>>
        +record(event, details)
    }
    class DomainError {
        <<abstract>>
    }
    class OrderNotFoundError
    class OrderNotExecutableError

    OrderController --> OrderUseCases
    OrderUseCases <|.. OrderService
    OrderService --> PortfolioCalculator
    OrderService --> MarketScheduler
    OrderService --> OrderRepository
    OrderService --> Clock
    OrderService --> AuditLog
    OrderService ..> DomainError : throws
    PortfolioCalculator <|.. OrderCalculator
    MarketScheduler <|.. WeekdayMarketScheduler
    OrderRepository <|.. InMemoryOrderRepository
    IdempotencyStore <|.. InMemoryIdempotencyStore
    DomainError <|-- OrderNotFoundError
    DomainError <|-- OrderNotExecutableError
```

## LLD 4 — Order calculation

`OrderCalculator` composes three pure functions. All arithmetic uses `decimal.js`;
rounding is always explicit.

```mermaid
flowchart TD
    input["totalAmount + portfolio<br/>(Decimal values)"] --> split["splitAmount<br/>largest-remainder, whole cents"]
    split --> splitNote["1. each line = total x pct / 100, rounded DOWN to cents<br/>2. leftover cents go one by one to the largest remainders<br/>-> lines sum exactly to total, each within 1 cent of its share"]
    splitNote --> perLine{{"for each stock"}}
    perLine --> price["resolvePrice<br/>partner marketPrice, else DEFAULT_STOCK_PRICE"]
    price --> qty["calculateQuantity<br/>quantity = amount / price, rounded DOWN to QUANTITY_PRECISION<br/>estimatedValue = quantity x price (cents)<br/>residualAmount = amount - estimatedValue"]
    qty --> zero{"quantity = 0?"}
    zero -- yes --> warn["warning + untradableLines"]
    zero -- no --> line["OrderLine"]
    warn --> line
    line --> totals["totals: allocated, estimatedValue, residual"]
    totals --> out["OrderCalculation"]
    out --> rule{"all lines untradable?"}
    rule -- yes --> reject["OrderService throws OrderNotExecutableError -> 422"]
    rule -- no --> accept["order is scheduled and stored"]
```

## LLD 5 — Execution time

`WeekdayMarketScheduler` decides in the exchange's time zone (default New York,
09:30–16:00), so the result is correct whatever the server's or partner's time zone and
across daylight-saving changes. Public holidays are not considered.

```mermaid
flowchart TD
    t["request time"] --> tz["convert to exchange time zone<br/>(Luxon, DST-aware)"]
    tz --> wd{"Monday-Friday?"}
    wd -- "no" --> wk["next Monday at open<br/>reason WEEKEND"]
    wd -- yes --> beforeOpen{"before open?"}
    beforeOpen -- yes --> today["today at open<br/>reason BEFORE_MARKET_OPEN"]
    beforeOpen -- no --> beforeClose{"before close?"}
    beforeClose -- yes --> now["immediately (request time)<br/>reason MARKET_OPEN"]
    beforeClose -- "no (at/after close)" --> next["next weekday at open<br/>reason AFTER_MARKET_CLOSE"]
```

## LLD 6 — Error handling

Errors are created where they happen and presented in one place. Business rules raise
domain errors with no HTTP knowledge; the edge maps them. Failures outside any request
are handled at process level.

```mermaid
flowchart LR
    subgraph sources["Where errors come from"]
        v["Validation (Zod)<br/>ValidationError"]
        mws["Middlewares<br/>AppError: 401, 405, 409, 415, 422, 429"]
        bp["Body parser<br/>http-errors, expose=true"]
        d["OrderService<br/>DomainError"]
        bug["Unexpected exception"]
    end

    subgraph handler["errorHandler"]
        a1["AppError -> its status and code"]
        a2["DomainError -> domain-error.mapper<br/>OrderNotFound 404, OrderNotExecutable 422"]
        a3["client http-error -> 400 / 413 / 415"]
        a4["anything else -> logged with stack<br/>generic 500 INTERNAL_ERROR"]
    end

    v --> a1
    mws --> a1
    d --> a2
    bp --> a3
    bug --> a4
    a1 & a2 & a3 & a4 --> body["{ error: { code, message, details }, requestId }"]

    subgraph proc["Process level (server.ts)"]
        ur["unhandledRejection /<br/>uncaughtException"] --> fatal["fatal log, readiness 503,<br/>drain 3 s, exit 1"]
        le["listen error<br/>e.g. port in use"] --> exit1["fatal log, exit 1"]
        sig["SIGTERM / SIGINT"] --> graceful["readiness 503, finish in-flight,<br/>exit 0 (force after 10 s)"]
    end
```

## Proposed production architecture

Not implemented: how the same design would run for real. Each change plugs into an
existing port, so the use cases stay the same.

```mermaid
flowchart LR
    partner["Partner backends"] -- "HTTPS (mTLS or OAuth2)" --> gw["API gateway / load balancer<br/>TLS, WAF, rate limits"]
    gw --> api1["Order Splitter<br/>instance 1"]
    gw --> api2["Order Splitter<br/>instance N"]

    subgraph data["Shared state"]
        pg[("PostgreSQL<br/>orders (OrderRepository)")]
        redis[("Redis<br/>idempotency keys, rate limits")]
    end

    subgraph external["External services"]
        md["Market data feed<br/>(price provider)"]
        cal["Exchange calendar<br/>(MarketScheduler)"]
        broker["Broker / exchange"]
    end

    api1 & api2 --> pg
    api1 & api2 --> redis
    api1 & api2 --> md
    api1 & api2 --> cal
    api1 & api2 -- "outbox" --> q[["Queue / scheduler<br/>(e.g. SQS, EventBridge)"]]
    q -- "at executeAt" --> worker["Execution worker"] --> broker
    broker -- "fills, rejections" --> worker
    worker -- "status updates / webhooks" --> partner

    api1 & api2 -.-> obs["Logs, metrics, traces,<br/>audit store, alerts"]
```
