import type { ErrorCode } from './error-codes';

export interface ErrorDetail {
  readonly path: string;
  readonly message: string;
}

/**
 * Errors the API is allowed to show to clients. Anything that is NOT an
 * AppError is treated as an unexpected 500 and its message is never exposed.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: readonly ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(details: readonly ErrorDetail[]) {
    const count = details.length;
    super(
      400,
      'VALIDATION_ERROR',
      `Request validation failed: ${count} problem${count === 1 ? '' : 's'} found (see details)`,
      details,
    );
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

/** Shortens client-supplied text before echoing it back in an error message. */
export const quote = (value: string, max = 40): string =>
  JSON.stringify(value.length > max ? `${value.slice(0, max)}…` : value);

/** Shortens client-supplied text (without quoting) before echoing it back. */
export const truncate = (value: string, max = 100): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;
