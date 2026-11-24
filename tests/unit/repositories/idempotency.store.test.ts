import { InMemoryIdempotencyStore } from '../../../src/repositories/idempotency.store';

const response = { statusCode: 201, body: { orderId: 'o-1' }, location: '/api/v1/orders/o-1' };

describe('InMemoryIdempotencyStore', () => {
  let now: number;
  let store: InMemoryIdempotencyStore;

  beforeEach(() => {
    now = Date.parse('2026-11-24T10:00:00Z');
    store = new InMemoryIdempotencyStore({ now: () => new Date(now) }, 60_000);
  });

  it('starts a new key', async () => {
    await expect(store.begin('p:k1', 'hash-a')).resolves.toEqual({ kind: 'started' });
  });

  it('reports in-progress while the first request is running', async () => {
    await store.begin('p:k1', 'hash-a');
    await expect(store.begin('p:k1', 'hash-a')).resolves.toEqual({ kind: 'in-progress' });
  });

  it('replays the stored response for the same key and body', async () => {
    await store.begin('p:k1', 'hash-a');
    await store.complete('p:k1', response);
    await expect(store.begin('p:k1', 'hash-a')).resolves.toEqual({ kind: 'replay', response });
  });

  it('detects the same key used with a different body', async () => {
    await store.begin('p:k1', 'hash-a');
    await store.complete('p:k1', response);
    await expect(store.begin('p:k1', 'hash-b')).resolves.toEqual({ kind: 'mismatch' });
  });

  it('lets a failed request be retried after release', async () => {
    await store.begin('p:k1', 'hash-a');
    await store.release('p:k1');
    await expect(store.begin('p:k1', 'hash-b')).resolves.toEqual({ kind: 'started' });
  });

  it('never releases a completed response', async () => {
    await store.begin('p:k1', 'hash-a');
    await store.complete('p:k1', response);
    await store.release('p:k1');
    await expect(store.begin('p:k1', 'hash-a')).resolves.toMatchObject({ kind: 'replay' });
  });

  it('forgets keys after the TTL', async () => {
    await store.begin('p:k1', 'hash-a');
    await store.complete('p:k1', response);
    now += 60_000;
    await expect(store.begin('p:k1', 'hash-b')).resolves.toEqual({ kind: 'started' });
  });

  it('keeps keys independent per scope', async () => {
    await store.begin('partner-a:k1', 'hash-a');
    await expect(store.begin('partner-b:k1', 'hash-z')).resolves.toEqual({ kind: 'started' });
  });

  it('returns copies so a replayed body cannot be mutated', async () => {
    await store.begin('p:k1', 'hash-a');
    await store.complete('p:k1', response);
    const first = await store.begin('p:k1', 'hash-a');
    if (first.kind === 'replay') (first.response.body as { orderId: string }).orderId = 'tampered';
    await expect(store.begin('p:k1', 'hash-a')).resolves.toEqual({ kind: 'replay', response });
  });
});

describe('InMemoryIdempotencyStore expiry order', () => {
  it('expires old records while keeping newer ones', async () => {
    let now = 0;
    const store = new InMemoryIdempotencyStore({ now: () => new Date(now) }, 1_000);

    await store.begin('p:old', 'h');
    now = 600;
    await store.begin('p:new', 'h');
    now = 1_000; // "old" has expired, "new" has not

    await expect(store.begin('p:old', 'other')).resolves.toEqual({ kind: 'started' });
    await expect(store.begin('p:new', 'h')).resolves.toEqual({ kind: 'in-progress' });
  });
});
