import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/app-error';
import type { Logger } from '../lib/logger';
import { getRequestId } from './request-id.middleware';

interface BodyParserError {
  type: string;
  status: number;
}

const isBodyParserError = (error: unknown): error is BodyParserError =>
  typeof error === 'object' &&
  error !== null &&
  'type' in error &&
  typeof error.type === 'string' &&
  'status' in error &&
  typeof error.status === 'number';

/** Maps express.json() failures to stable, documented error codes. */
const fromBodyParser = (error: BodyParserError): AppError => {
  switch (error.type) {
    case 'entity.parse.failed':
      return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
    case 'entity.too.large':
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    default:
      return new AppError(
        error.status >= 400 && error.status < 500 ? error.status : 400,
        'BAD_REQUEST',
        'Request body could not be read',
      );
  }
};

/**
 * Single place that turns errors into HTTP responses:
 * { error: { code, message, details }, requestId }.
 * Unexpected errors are logged with their stack but clients only ever see a
 * generic 500 message, never internals.
 */
export const errorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = getRequestId(res.locals);
    let appError: AppError;

    if (error instanceof AppError) {
      appError = error;
    } else if (isBodyParserError(error)) {
      appError = fromBodyParser(error);
    } else {
      logger.error({ err: error, requestId }, 'Unhandled error');
      appError = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }

    res.status(appError.statusCode).json({
      error: { code: appError.code, message: appError.message, details: appError.details },
      requestId,
    });
  };
