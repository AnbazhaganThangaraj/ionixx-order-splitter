import type { RequestHandler } from 'express';
import { NotFoundError } from '../errors/app-error';

export const notFound = (): RequestHandler => (req, _res, next) => {
  next(
    new NotFoundError(
      `Route ${req.method} ${req.path} does not exist; see /docs for the available endpoints`,
    ),
  );
};
