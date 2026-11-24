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

/** Reads the port the server actually bound (PORT=0 lets the OS pick a free one). */
const boundPort = (output: string): string => {
  const match = /listening on http:\/\/localhost:(\d+)/.exec(output);
  if (match?.[1] === undefined) throw new Error('server did not report its port');
  return match[1];
};

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
});

describe('server process', () => {
  it('starts, serves requests and shuts down gracefully on SIGTERM with exit code 0', async () => {
    const server = startServer({ PORT: '0' });
    await waitFor(() => server.output().includes('listening on'));
    const port = boundPort(server.output());

    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(response.status).toBe(200);

    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    expect(server.output()).toContain('Shutting down: draining connections');
    expect(server.output()).toContain('HTTP server closed');
  });

  it('exits with code 1 and a clear fatal log when the port is already in use', async () => {
    const first = startServer({ PORT: '0' });
    await waitFor(() => first.output().includes('listening on'));
    const port = boundPort(first.output());

    const second = startServer({ PORT: port });
    expect(await second.exited).toBe(1);
    expect(second.output()).toContain(`port ${port} is already in use`);
    expect(second.output()).not.toContain('listening on');
  });

  it('exits with code 1 and lists the problems when configuration is invalid', async () => {
    const server = startServer({ PORT: '0', QUANTITY_PRECISION: '-1' });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('Invalid configuration');
    expect(server.output()).toContain('QUANTITY_PRECISION');
  });

  it('refuses to start when authentication is neither configured nor explicitly disabled', async () => {
    const server = startServer({ PORT: '0', AUTH_DISABLED: '' });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('no API keys configured');
    expect(server.output()).toContain('cp .env.example .env');
  });

  it('refuses to start in production without API keys', async () => {
    const server = startServer({ PORT: '0', NODE_ENV: 'production', AUTH_DISABLED: '' });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('is required when NODE_ENV=production');
  });
});
