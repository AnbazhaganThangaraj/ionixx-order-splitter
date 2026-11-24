import type { RequestHandler } from 'express';
import { AppError, quote } from '../errors/app-error';

/** Rejects bodies that are not declared as JSON instead of treating them as empty. */
export const requireJson = (): RequestHandler => (req, _res, next) => {
  if (!req.is('application/json')) {
    const received = req.get('content-type');
    next(
      new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        `Content-Type must be application/json (${
          received === undefined ? 'no Content-Type header was sent' : `got ${quote(received)}`
        })`,
      ),
    );
    return;
  }
  next();
};
