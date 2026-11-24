import type { ErrorRequestHandler } from 'express';
import { AppError, quote } from '../errors/app-error';
import type { Logger } from '../lib/logger';
import { getRequestId } from './request-id.middleware';

/**
 * Errors created with the `http-errors` convention (used by express.json / body-parser):
 * `expose: true` means the message is safe to show and the status is a client error.
 */
interface HttpClientError {
  readonly status: number;
  readonly expose: true;
  readonly message: string;
  readonly type?: string;
  readonly limit?: number;
  readonly charset?: string;
  readonly encoding?: string;
}

const isHttpClientError = (error: unknown): error is HttpClientError =>
  typeof error === 'object' &&
  error !== null &&
  'expose' in error &&
  error.expose === true &&
  'status' in error &&
  typeof error.status === 'number' &&
  error.status >= 400 &&
  error.status < 500;

const formatBytes = (bytes: number): string =>
  bytes >= 1024 ? `${Math.round(bytes / 1024)}kb` : `${bytes} bytes`;

/** Turns request-reading failures (JSON parsing, size, charset, compression) into API errors. */
const fromHttpClientError = (error: HttpClientError): AppError => {
  switch (error.type) {
    case 'entity.parse.failed':
      return new AppError(
        400,
        'INVALID_JSON',
        'Request body is not valid JSON; send a JSON object',
        [
          // The parser's message points at the problem, e.g. "... at position 20".
          { path: 'body', message: error.message.slice(0, 200) },
        ],
      );
    case 'entity.too.large':
      return new AppError(
        413,
        'PAYLOAD_TOO_LARGE',
        `Request body is too large (limit ${formatBytes(error.limit ?? 0)})`,
      );
    case 'charset.unsupported':
      return new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        `Unsupported charset ${quote((error.charset ?? 'unknown').toUpperCase())}; send JSON encoded as UTF-8`,
      );
    case 'encoding.unsupported':
      return new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        `Unsupported Content-Encoding ${quote(error.encoding ?? 'unknown')}; use gzip, deflate, br or none`,
      );
    default:
      // e.g. a gzip/br body that fails to decompress, or a body shorter than Content-Length.
      return new AppError(
        error.status,
        'BAD_REQUEST',
        `Request body could not be read: ${error.message.slice(0, 200)}`,
      );
  }
};

/**
 * Single place that turns errors into HTTP responses:
 * { error: { code, message, details }, requestId }.
 *
 * - AppError                 -> its own status, code and message
 * - http-errors client error -> mapped to a 4xx with a specific code (never a 500)
 * - anything else            -> logged with its stack; client gets a generic 500
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
    } else if (isHttpClientError(error)) {
      appError = fromHttpClientError(error);
    } else {
      logger.error({ err: error, requestId }, 'Unhandled error');
      appError = new AppError(
        500,
        'INTERNAL_ERROR',
        'An unexpected error occurred. Please retry later; if it keeps happening, contact support with the requestId.',
      );
    }

    res.status(appError.statusCode).json({
      error: { code: appError.code, message: appError.message, details: appError.details },
      requestId,
    });
  };
