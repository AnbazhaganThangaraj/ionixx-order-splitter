import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import autocannon, { type Result } from 'autocannon';

/**
 * Load test for the order splitter API.
 *
 *   npm run build && npm run perf
 *
 * Starts the compiled server (dist/server.js) in production mode with authentication on,
 * runs each scenario with autocannon, prints a Markdown table and writes
 * perf/results/latest.json. Rate limits are raised so they do not cap the measurement.
 * Override with PERF_CONNECTIONS, PERF_DURATION (seconds) and PERF_OUTPUT (file name).
 */
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PERF_PORT ?? 3900);
const BASE = `http://127.0.0.1:${PORT}`;
const CONNECTIONS = Number(process.env.PERF_CONNECTIONS ?? 50);
const DURATION = Number(process.env.PERF_DURATION ?? 8);
const API_KEY = 'perf-test-key-0123456789abcdefghij';
const OUTPUT = process.env.PERF_OUTPUT ?? 'latest.json';

interface PortfolioItem {
  symbol: string;
  allocation: string;
  marketPrice: string;
}

const portfolio = (size: number): PortfolioItem[] =>
  Array.from({ length: size }, (_, i) => ({
    symbol: `SYM${i}`,
    allocation: (100 / size).toFixed(4),
    marketPrice: (50 + i * 1.37).toFixed(2),
  })).map((item, i, all) =>
    // make the allocations add up to exactly 100
    i === all.length - 1
      ? {
          ...item,
          allocation: (100 - Number((100 / size).toFixed(4)) * (size - 1)).toFixed(4),
        }
      : item,
  );

const order = (size: number): string =>
  JSON.stringify({ orderType: 'BUY', totalAmount: '10000.00', portfolio: portfolio(size) });

const headers = { 'content-type': 'application/json', 'x-api-key': API_KEY };

interface Scenario {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  extraHeaders?: Record<string, string>;
  /** Send a fresh Idempotency-Key on every request. */
  uniqueIdempotencyKey?: boolean;
}

/** Resident memory of the server process in MB (Linux /proc), or undefined elsewhere. */
const serverRssMb = (pid: number | undefined): number | undefined => {
  const file = `/proc/${String(pid)}/status`;
  if (pid === undefined || !existsSync(file)) return undefined;
  const match = /VmRSS:\s+(\d+) kB/.exec(readFileSync(file, 'utf8'));
  return match?.[1] === undefined ? undefined : Math.round(Number(match[1]) / 1024);
};

const startServer = (): Promise<ChildProcess> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/server.js'], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'production',
        PORT: String(PORT),
        LOG_LEVEL: 'info',
        API_KEYS: `perf:${API_KEY}`,
        // 100k requests per 1 s window: effectively unlimited, so limits do not cap results.
        RATE_LIMIT_MAX: '100000',
        RATE_LIMIT_WINDOW_MS: '1000',
        PARTNER_RATE_LIMIT_MAX: '1000000',
      },
      // Logs are produced (realistic cost) but discarded.
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('error', reject);
    const deadline = Date.now() + 10_000;
    const poll = (): void => {
      fetch(`${BASE}/health/ready`)
        .then((r) => {
          if (r.ok) resolve(child);
          else setTimeout(poll, 100);
        })
        .catch(() => {
          if (Date.now() > deadline) reject(new Error('server did not start'));
          else setTimeout(poll, 100);
        });
    };
    poll();
  });

const run = (scenario: Scenario): Promise<Result> =>
  autocannon({
    url: `${BASE}${scenario.path}`,
    method: scenario.method,
    headers: { ...headers, ...scenario.extraHeaders },
    ...(scenario.body === undefined ? {} : { body: scenario.body }),
    ...(scenario.uniqueIdempotencyKey === true
      ? {
          requests: [
            {
              setupRequest: (req) => ({
                ...req,
                headers: { ...req.headers, 'idempotency-key': randomUUID() },
              }),
            },
          ],
        }
      : {}),
    connections: CONNECTIONS,
    duration: DURATION,
  });

const ordersCount = async (): Promise<number> => {
  const res = await fetch(`${BASE}/api/v1/orders?limit=1`, { headers });
  if (!res.ok) throw new Error(`could not read order count: HTTP ${String(res.status)}`);
  return ((await res.json()) as { pagination: { total: number } }).pagination.total;
};

const main = async (): Promise<void> => {
  const server = await startServer();
  try {
    const created = await fetch(`${BASE}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: order(2),
    });
    const { orderId } = (await created.json()) as { orderId: string };

    const scenarios: Scenario[] = [
      { name: 'GET /health/live (baseline)', method: 'GET', path: '/health/live' },
      { name: 'POST /orders, 2 stocks', method: 'POST', path: '/api/v1/orders', body: order(2) },
      { name: 'POST /orders, 10 stocks', method: 'POST', path: '/api/v1/orders', body: order(10) },
      {
        name: 'POST /orders, 100 stocks (max)',
        method: 'POST',
        path: '/api/v1/orders',
        body: order(100),
      },
      {
        name: 'POST /orders, idempotent replay',
        method: 'POST',
        path: '/api/v1/orders',
        body: order(2),
        extraHeaders: { 'idempotency-key': 'perf-replay' },
      },
      {
        name: 'POST /orders, unique Idempotency-Key each',
        method: 'POST',
        path: '/api/v1/orders',
        body: order(2),
        uniqueIdempotencyKey: true,
      },
      { name: 'GET /orders/{id}', method: 'GET', path: `/api/v1/orders/${orderId}` },
      { name: 'GET /orders?limit=20', method: 'GET', path: '/api/v1/orders?limit=20' },
    ];

    const rows: Record<string, unknown>[] = [];
    for (const scenario of scenarios) {
      const before = await ordersCount();
      const result = await run(scenario);
      rows.push({
        scenario: scenario.name,
        requestsPerSec: Math.round(result.requests.average),
        // autocannon's latency histogram has 1 ms resolution, so derive the mean from
        // Little's law for a closed-loop test: mean latency = connections / throughput.
        meanMs: Math.round(((CONNECTIONS * 1000) / result.requests.average) * 1000) / 1000,
        p50ms: result.latency.p50,
        p90ms: result.latency.p90,
        p99ms: result.latency.p99,
        maxMs: result.latency.max,
        requests: result.requests.total,
        non2xx: result.non2xx,
        errors: result.errors + result.timeouts,
        ordersInMemoryAtStart: before,
      });
      process.stdout.write(`done: ${scenario.name}\n`);
    }

    const environment = {
      date: new Date().toISOString(),
      node: process.version,
      cpus: `${os.cpus().length} x ${os.cpus()[0]?.model ?? 'unknown'}`,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      platform: `${os.platform()} ${os.release()}`,
      serverRssMbAtEnd: serverRssMb(server.pid),
      connections: CONNECTIONS,
      durationSecondsPerScenario: DURATION,
    };
    writeFileSync(
      path.join(ROOT, 'perf/results', OUTPUT),
      `${JSON.stringify({ environment, results: rows }, null, 2)}\n`,
    );

    console.log(
      '\n| Scenario | req/s | mean ms | p50 ms | p90 ms | p99 ms | max ms | non-2xx | errors |',
    );
    console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const r of rows) {
      console.log(
        `| ${String(r.scenario)} | ${String(r.requestsPerSec)} | ${String(r.meanMs)} | ${String(r.p50ms)} | ${String(r.p90ms)} | ${String(r.p99ms)} | ${String(r.maxMs)} | ${String(r.non2xx)} | ${String(r.errors)} |`,
      );
    }
    console.log(
      `\nOrders in memory at the end: ${String(await ordersCount())}; ` +
        `server memory (RSS): ${String(serverRssMb(server.pid) ?? 'n/a')} MB`,
    );
    console.log(JSON.stringify(environment));
  } finally {
    server.kill('SIGTERM');
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
