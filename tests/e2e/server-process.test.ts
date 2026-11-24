import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';

/**
 * Starts the real server (src/server.ts via tsx) as a child process to check
 * behaviour that only exists at process level: startup failures, exit codes and
 * graceful shutdown.
 */
jest.setTimeout(30_000);

const ROOT = path.resolve(__dirname, '../..');
const children: ChildProcess[] = [];

interface Started {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

const startServer = (env: Record<string, string>): Started => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      AUTH_DISABLED: 'true',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  const append = (chunk: Buffer): void => {
    output += chunk.toString();
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
  });
  return { child, output: () => output, exited };
};

const waitFor = async (check: () => boolean, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for server output');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const randomPort = (): string => String(40_000 + Math.floor(Math.random() * 10_000));

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
});

describe('server process', () => {
  it('starts, serves requests and shuts down gracefully on SIGTERM with exit code 0', async () => {
    const port = randomPort();
    const server = startServer({ PORT: port });
    await waitFor(() => server.output().includes('listening on'));

    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(response.status).toBe(200);

    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    expect(server.output()).toContain('Shutting down: draining connections');
    expect(server.output()).toContain('HTTP server closed');
  });

  it('exits with code 1 and a clear fatal log when the port is already in use', async () => {
    const port = randomPort();
    const first = startServer({ PORT: port });
    await waitFor(() => first.output().includes('listening on'));

    const second = startServer({ PORT: port });
    expect(await second.exited).toBe(1);
    expect(second.output()).toContain(`port ${port} is already in use`);
    expect(second.output()).not.toContain('listening on');
  });

  it('exits with code 1 and lists the problems when configuration is invalid', async () => {
    const server = startServer({ PORT: randomPort(), QUANTITY_PRECISION: '-1' });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('Invalid configuration');
    expect(server.output()).toContain('QUANTITY_PRECISION');
  });

  it('refuses to start when authentication is neither configured nor explicitly disabled', async () => {
    const server = startServer({ PORT: randomPort(), AUTH_DISABLED: '' });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('no API keys configured');
  });

  it('refuses to start in production without API keys', async () => {
    const server = startServer({ PORT: randomPort(), NODE_ENV: 'production', AUTH_DISABLED: '' });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('is required when NODE_ENV=production');
  });
});
