# Configuration

All settings come from environment variables (or a `.env` file, see `.env.example`).

| Variable                  | Default            | Description                                                                                                          |
| ------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `PORT`                    | `3000`             | HTTP port (`0` = any free port; the bound port is logged)                                                            |
| `NODE_ENV`                | `development`      | `development`, `test` or `production`                                                                                |
| `LOG_LEVEL`               | `info`             | pino level (`silent` … `trace`)                                                                                      |
| `DEFAULT_STOCK_PRICE`     | `100`              | Price (USD) used when the partner does not send `marketPrice`                                                        |
| `QUANTITY_PRECISION`      | `3`                | Decimal places allowed for share quantities (0–10), e.g. `7`                                                         |
| `MARKET_TIMEZONE`         | `America/New_York` | IANA time zone of the exchange                                                                                       |
| `MARKET_OPEN_TIME`        | `09:30`            | Session open, `HH:mm`, in the exchange time zone                                                                     |
| `MARKET_CLOSE_TIME`       | `16:00`            | Session close, `HH:mm`, in the exchange time zone (exclusive)                                                        |
| `API_KEY_HASHES`          | _(empty)_          | `partnerId:sha256hex,…` — production format (see `npm run hash-key`)                                                 |
| `API_KEYS`                | _(empty)_          | `partnerId:key,…` plaintext keys (≥ 24 chars), for local development only                                            |
| `AUTH_DISABLED`           | `false`            | `true` runs without authentication. Local development only: refused with `NODE_ENV=production` or together with keys |
| `PARTNER_RATE_LIMIT_MAX`  | `600`              | Max `/api/v1` requests per authenticated partner per window                                                          |
| `RATE_LIMIT_MAX`          | `100`              | Max `/api/v1` requests per client IP per window                                                                      |
| `RATE_LIMIT_WINDOW_MS`    | `60000`            | Rate-limit window in milliseconds                                                                                    |
| `IDEMPOTENCY_TTL_SECONDS` | `86400`            | How long an `Idempotency-Key` response can be replayed                                                               |
| `TRUST_PROXY`             | `0`                | Number of proxies/load balancers in front (0 = ignore `X-Forwarded-For`)                                             |

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

**Authentication fails closed.** The app refuses to start unless API keys are configured
(`API_KEY_HASHES` or `API_KEYS`) or authentication is disabled explicitly with
`AUTH_DISABLED=true` (local development only). In production, configure hashes so the
keys never sit in configuration:

```bash
npm run hash-key -- --generate partner-a   # prints a new key (give it to the partner) and its hash
API_KEY_HASHES="partner-a:<sha256-hex>" NODE_ENV=production npm start
```

Integer settings accept plain digits only (`"1e3"`, `"0x10"` and `"2.5"` are rejected).
