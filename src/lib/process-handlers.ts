import type { Logger } from './logger';

export type FatalReason = 'unhandledRejection' | 'uncaughtException';

/**
 * Last line of defence for errors that escaped every try/catch and the Express
 * error handler (e.g. a rejected promise nobody awaited, or a throw inside a timer).
 *
 * After such an error the process state is unknown, so continuing is unsafe: log a
 * structured fatal line (with the stack) and let `onFatal` shut down with exit code 1
 * so the orchestrator (Docker, Kubernetes) restarts a clean process.
 */
export const registerProcessHandlers = (
  proc: NodeJS.EventEmitter,
  logger: Logger,
  onFatal: (reason: FatalReason) => void,
): void => {
  proc.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection; shutting down');
    onFatal('unhandledRejection');
  });

  proc.on('uncaughtException', (error: Error, origin: string) => {
    logger.fatal({ err: error, origin }, 'Uncaught exception; shutting down');
    onFatal('uncaughtException');
  });
};
