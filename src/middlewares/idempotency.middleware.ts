import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError, ValidationError } from '../errors/app-error';
import type { IdempotencyStore } from '../repositories/idempotency.store';
import { getPartnerId } from './api-key-auth.middleware';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const SAFE_KEY = /^[A-Za-z0-9._:-]{1,255}$/;

/** JSON with object keys sorted, so {"a":1,"b":2} and {"b":2,"a":1} hash the same. */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
};

/**
 * Optional Idempotency-Key support for POST requests (same idea as Stripe's API):
 *
 * - first request with a key  -> processed normally; a 2xx response is stored
 * - retry, same key + body    -> stored response replayed (Idempotent-Replayed: true)
 * - same key, different body  -> 422 IDEMPOTENCY_KEY_REUSED
 * - retry while the first is still running -> 409 IDEMPOTENCY_REQUEST_IN_PROGRESS
 * - non-2xx outcomes are not stored, so a corrected request can reuse the key
 *
 * Keys are scoped per partner, so two partners can never collide.
 */
export const idempotency =
  (store: IdempotencyStore): RequestHandler =>
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
          message: 'must be 1-255 characters: letters, digits, ".", "_", ":" or "-"',
        },
      ]);
    }

    const scope = `${getPartnerId(res.locals)}:${key}`;
    const requestHash = createHash('sha256').update(stableStringify(req.body)).digest('hex');
    const result = await store.begin(scope, requestHash);

    switch (result.kind) {
      case 'mismatch':
        throw new AppError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used with a different request body',
        );
      case 'in-progress':
        throw new AppError(
          409,
          'IDEMPOTENCY_REQUEST_IN_PROGRESS',
          'A request with this Idempotency-Key is still being processed; retry shortly',
        );
      case 'replay': {
        const { statusCode, body, location } = result.response;
        res.setHeader('Idempotent-Replayed', 'true');
        if (location !== undefined) res.setHeader('Location', location);
        res.status(statusCode).json(body);
        return;
      }
      case 'started':
        break;
    }

    let responseBody: unknown;
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      responseBody = body;
      return originalJson(body);
    };

    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      const succeeded = res.writableFinished && res.statusCode >= 200 && res.statusCode < 300;
      const location = res.getHeader('Location');
      const done = succeeded
        ? store.complete(scope, {
            statusCode: res.statusCode,
            body: responseBody,
            location: typeof location === 'string' ? location : undefined,
          })
        : store.release(scope);
      done.catch(() => undefined);
    };
    res.on('finish', settle);
    res.on('close', settle);

    next();
  };
