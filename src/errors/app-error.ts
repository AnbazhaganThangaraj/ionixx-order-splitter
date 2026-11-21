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
    public readonly code: string,
    message: string,
    public readonly details: readonly ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(details: readonly ErrorDetail[], message = 'Request validation failed') {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}
