import type { Express } from 'express';
import { createApp, type AppDependencies } from '../../src/app';
import { loadConfig } from '../../src/config/app.config';
import { createLogger } from '../../src/lib/logger';

export interface LogEntry {
  level: number;
  msg: string;
  [key: string]: unknown;
}

export interface TestApp {
  app: Express;
  logs: LogEntry[];
}

/** Builds the real app with a log sink we can inspect and optional overrides. */
export const buildTestApp = (
  env: Record<string, string> = {},
  deps: AppDependencies = {},
): TestApp => {
  const logs: LogEntry[] = [];
  const logger = createLogger('info', {
    write: (line: string) => {
      logs.push(JSON.parse(line) as LogEntry);
    },
  });
  const app = createApp(loadConfig({ NODE_ENV: 'test', ...env }), { logger, ...deps });
  return { app, logs };
};

/** A clock frozen at the given instant. */
export const fixedClock = (iso: string) => ({ now: () => new Date(iso) });
