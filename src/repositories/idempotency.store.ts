import type { Clock } from '../lib/clock';

export interface StoredResponse {
  readonly statusCode: number;
  readonly body: unknown;
  readonly location?: string | undefined;
}

export type BeginResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'replay'; readonly response: StoredResponse }
  | { readonly kind: 'mismatch' }
  | { readonly kind: 'in-progress' };

/**
 * Remembers the outcome of requests sent with an Idempotency-Key so a retried
 * request returns the original response instead of creating a second order.
 * Async so a shared store (e.g. Redis with SET NX + TTL) can implement it later.
 */
export interface IdempotencyStore {
  /** Atomically claim the key, or report what already happened with it. */
  begin(scope: string, requestHash: string): Promise<BeginResult>;
  /** Save the successful response for replay. */
  complete(scope: string, response: StoredResponse): Promise<void>;
  /** Forget an in-progress claim (the request failed, so it may be retried). */
  release(scope: string): Promise<void>;
}

interface IdempotencyRecord {
  readonly requestHash: string;
  readonly expiresAt: number;
  readonly response?: StoredResponse;
}

/**
 * Per-process store with time-based expiry. Node runs JavaScript on one thread,
 * so check-and-set inside begin() is atomic for a single instance.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs: number,
  ) {}

  begin(scope: string, requestHash: string): Promise<BeginResult> {
    this.removeExpired();
    const existing = this.records.get(scope);

    if (existing === undefined) {
      this.records.set(scope, { requestHash, expiresAt: this.now() + this.ttlMs });
      return Promise.resolve({ kind: 'started' });
    }
    if (existing.requestHash !== requestHash) {
      return Promise.resolve({ kind: 'mismatch' });
    }
    if (existing.response === undefined) {
      return Promise.resolve({ kind: 'in-progress' });
    }
    return Promise.resolve({ kind: 'replay', response: structuredClone(existing.response) });
  }

  complete(scope: string, response: StoredResponse): Promise<void> {
    const existing = this.records.get(scope);
    if (existing !== undefined) {
      this.records.set(scope, { ...existing, response: structuredClone(response) });
    }
    return Promise.resolve();
  }

  release(scope: string): Promise<void> {
    const existing = this.records.get(scope);
    if (existing?.response === undefined) {
      this.records.delete(scope);
    }
    return Promise.resolve();
  }

  /**
   * Every record has the same TTL and the Map keeps insertion order, so records are
   * also in expiry order: stop at the first one that has not expired. Cost is
   * proportional to the number of expired records, not to the size of the store.
   */
  private removeExpired(): void {
    const now = this.now();
    for (const [scope, record] of this.records) {
      if (record.expiresAt > now) break;
      this.records.delete(scope);
    }
  }

  private now(): number {
    return this.clock.now().getTime();
  }
}
