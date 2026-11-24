import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { ApiKeyEntry } from '../config/app.config';
import { AppError } from '../errors/app-error';

export const API_KEY_HEADER = 'x-api-key';

/** Partner id used for every request when authentication is disabled (local development). */
export const ANONYMOUS_PARTNER = 'anonymous';

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Authenticates partners by the X-API-Key header and puts their id in res.locals.
 *
 * Keys are compared as SHA-256 digests with timingSafeEqual, and every stored key is
 * checked (no early exit), so response timing does not reveal how much of a guess
 * was right or which key matched.
 */
export const apiKeyAuth = (apiKeys: readonly ApiKeyEntry[]): RequestHandler => {
  const stored = apiKeys.map(({ partnerId, key }) => ({ partnerId, digest: sha256(key) }));

  return (req, res, next) => {
    if (stored.length === 0) {
      res.locals.partnerId = ANONYMOUS_PARTNER;
      next();
      return;
    }

    const provided = req.get(API_KEY_HEADER);
    let partnerId: string | undefined;
    if (provided !== undefined && provided.length > 0) {
      const providedDigest = sha256(provided);
      for (const entry of stored) {
        if (timingSafeEqual(providedDigest, entry.digest) && partnerId === undefined) {
          partnerId = entry.partnerId;
        }
      }
    }

    if (partnerId === undefined) {
      res.setHeader('WWW-Authenticate', 'ApiKey header="X-API-Key"');
      next(new AppError(401, 'UNAUTHORIZED', 'Missing or invalid API key'));
      return;
    }

    res.locals.partnerId = partnerId;
    next();
  };
};

export const getPartnerId = (locals: Record<string, unknown>): string => {
  if (typeof locals.partnerId !== 'string') {
    // Programming error: route mounted without apiKeyAuth.
    throw new Error('partnerId missing: apiKeyAuth middleware not applied');
  }
  return locals.partnerId;
};
