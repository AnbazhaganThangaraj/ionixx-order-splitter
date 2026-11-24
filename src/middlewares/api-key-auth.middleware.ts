import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { ApiKeyEntry } from '../config/app.config';
import { AppError } from '../errors/app-error';
import type { AuditLog } from '../lib/audit';
import { getRequestId } from '../lib/request-context';

export const API_KEY_HEADER = 'x-api-key';

/** Partner id used for every request when authentication is disabled (local development). */
export const ANONYMOUS_PARTNER = 'anonymous';

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Authenticates partners by the X-API-Key header and puts their id in res.locals.
 *
 * Only SHA-256 digests of keys are held in memory. The presented key is hashed and
 * compared with timingSafeEqual, and every stored key is
 * checked (no early exit), so response timing does not reveal how much of a guess
 * was right or which key matched.
 */
export const apiKeyAuth = (apiKeys: readonly ApiKeyEntry[], audit: AuditLog): RequestHandler => {
  const stored = apiKeys.map(({ partnerId, keyHash }) => ({
    partnerId,
    digest: Buffer.from(keyHash, 'hex'),
  }));

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
      audit.record('auth.failed', {
        requestId: getRequestId(res.locals),
        clientIp: req.ip,
        reason: provided === undefined || provided.length === 0 ? 'missing_key' : 'invalid_key',
        route: req.originalUrl.split('?')[0],
      });
      res.setHeader('WWW-Authenticate', 'ApiKey header="X-API-Key"');
      // Saying whether the key was missing or wrong reveals nothing an attacker does not
      // already know, and saves a partner's developer a debugging session.
      next(
        new AppError(
          401,
          'UNAUTHORIZED',
          provided === undefined || provided.length === 0
            ? 'API key is missing: send your key in the X-API-Key header'
            : 'API key is invalid: check the X-API-Key header value',
        ),
      );
      return;
    }

    res.locals.partnerId = partnerId;
    next();
  };
};
