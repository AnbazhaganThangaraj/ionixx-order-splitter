import type { RequestHandler } from 'express';
import { AppError, ValidationError } from '../errors/app-error';
import type { AuditLog } from '../lib/audit';
import { onResponseSettled } from '../lib/capture-response';
import { sha256Hex } from '../lib/crypto';
import type { Logger } from '../lib/logger';
import { getPartnerId, getRequestId } from '../lib/request-context';
import { stableStringify } from '../lib/stable-json';
import type { IdempotencyStore } from '../repositories/idempotency.store';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
/** Accepted key format; also published in the OpenAPI document. */
export const IDEMPOTENCY_KEY_PATTERN = '^[A-Za-z0-9._:-]{1,255}$';
const SAFE_KEY = new RegExp(IDEMPOTENCY_KEY_PATTERN);

/**
 * Optional Idempotency-Key support for POST requests (same idea as Stripe's API):
 *
 * - first request with a key  -> processed normally; a 2xx response is stored
 * - retry, same key + body    -> stored response replayed (Idempotent-Replayed: true)
 * - same key, different body  -> 422 IDEMPOTENCY_KEY_REUSED
 * - retry while the first is still running -> 409 IDEMPOTENCY_REQUEST_IN_PROGRESS
 * - non-2xx outcomes are not stored, so a corrected request can reuse the key
 *
 * Keys are scoped per partner, so two partners can never collide. Body hashing and
 * response capture live in lib/; this middleware only applies the policy.
 */
export const idempotency =
  (store: IdempotencyStore, audit: AuditLog, logger: Logger): RequestHandler =>
  async (req, res, next) => {
    const key = req.get(IDEMPOTENCY_HEADER);
    if (key === undefined) {
      next();
      return;
    }
    if (!SAFE_KEY.test(key)) {
      throw new ValidationError([
        {
          path: 'headers.idempotency-key',
          message:
            'must be 1-255 characters of letters, digits, ".", "_", ":" or "-" (a UUID works well)',
        },
      ]);
    }

    const partnerId = getPartnerId(res.locals);
    const context = { requestId: getRequestId(res.locals), partnerId, idempotencyKey: key };
    const scope = `${partnerId}:${key}`;
    const result = await store.begin(scope, sha256Hex(stableStringify(req.body)));

    switch (result.kind) {
      case 'mismatch':
        audit.record('idempotency.conflict', { ...context, reason: 'different_body' });
        throw new AppError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used with a different request body; ' +
            'use a new key for a new request, or resend the original body to get the original response',
        );
      case 'in-progress':
        audit.record('idempotency.conflict', { ...context, reason: 'in_progress' });
        throw new AppError(
          409,
          'IDEMPOTENCY_REQUEST_IN_PROGRESS',
          'A request with this Idempotency-Key is still being processed; retry shortly',
        );
      case 'replay': {
        const { statusCode, body, location } = result.response;
        audit.record('idempotency.replayed', context);
        res.setHeader('Idempotent-Replayed', 'true');
        if (location !== undefined) res.setHeader('Location', location);
        res.status(statusCode).json(body);
        return;
      }
      case 'started':
        break;
    }

    onResponseSettled(res, ({ succeeded, statusCode, body, location }) => {
      const done = succeeded
        ? store.complete(scope, { statusCode, body, location })
        : store.release(scope);
      // The response has already been sent; a store failure must not crash the request,
      // but it must not be silent either (idempotency would quietly stop working).
      done.catch((error: unknown) => {
        logger.warn({ err: error, ...context }, 'Idempotency store update failed');
      });
    });

    next();
  };
