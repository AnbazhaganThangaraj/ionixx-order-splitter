import type { RequestHandler } from 'express';
import { NotFoundError, truncate } from '../errors/app-error';

export const notFound = (): RequestHandler => (req, _res, next) => {
  next(
    new NotFoundError(
      `Route ${req.method} ${truncate(req.path)} does not exist; see /docs for the available endpoints`,
    ),
  );
};
