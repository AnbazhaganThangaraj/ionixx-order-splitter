import { EventEmitter } from 'node:events';
import { createLogger } from '../../../src/lib/logger';
import { type FatalReason, registerProcessHandlers } from '../../../src/lib/process-handlers';

const setup = () => {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger('info', {
    write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const proc = new EventEmitter();
  const fatal: FatalReason[] = [];
  registerProcessHandlers(proc, logger, (reason) => fatal.push(reason));
  return { proc, lines, fatal };
};

describe('registerProcessHandlers', () => {
  it('logs an unhandled rejection as fatal, with the stack, and triggers shutdown', () => {
    const { proc, lines, fatal } = setup();

    proc.emit('unhandledRejection', new Error('nobody awaited me'), Promise.resolve());

    expect(fatal).toEqual(['unhandledRejection']);
    expect(lines[0]).toMatchObject({
      level: 60,
      msg: 'Unhandled promise rejection; shutting down',
    });
    expect((lines[0]?.err as { message: string; stack: string }).message).toBe('nobody awaited me');
    expect((lines[0]?.err as { stack: string }).stack).toContain('Error: nobody awaited me');
  });

  it('handles rejections with non-Error reasons', () => {
    const { proc, lines, fatal } = setup();
    proc.emit('unhandledRejection', 'plain string reason', Promise.resolve());
    expect(fatal).toEqual(['unhandledRejection']);
    expect(lines[0]?.err).toBe('plain string reason');
  });

  it('logs an uncaught exception as fatal, with its origin, and triggers shutdown', () => {
    const { proc, lines, fatal } = setup();

    proc.emit('uncaughtException', new TypeError('boom'), 'uncaughtException');

    expect(fatal).toEqual(['uncaughtException']);
    expect(lines[0]).toMatchObject({
      level: 60,
      origin: 'uncaughtException',
      msg: 'Uncaught exception; shutting down',
    });
  });
});
