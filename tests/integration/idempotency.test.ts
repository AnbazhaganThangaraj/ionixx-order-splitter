import request from 'supertest';
import type { Order } from '../../src/domain/order.types';
import { InMemoryOrderRepository } from '../../src/repositories/in-memory-order.repository';
import { briefExampleRequest } from '../fixtures/orders';
import { buildTestApp } from '../helpers/test-app';

const ORDERS = '/api/v1/orders';

describe('Idempotency-Key', () => {
  it('replays the original response for a retried request instead of creating a new order', async () => {
    const { app } = buildTestApp();

    const first = await request(app)
      .post(ORDERS)
      .set('Idempotency-Key', 'order-123')
      .send(briefExampleRequest);
    const retry = await request(app)
      .post(ORDERS)
      .set('Idempotency-Key', 'order-123')
      .send(briefExampleRequest);

    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.headers.location).toBe(first.headers.location);
    expect(retry.body).toEqual(first.body);

    const history = await request(app).get(ORDERS);
    expect(history.body.pagination.total).toBe(1);
  });

  it('treats a body with the same content in a different key order as the same request', async () => {
    const { app } = buildTestApp();
    const reordered = {
      portfolio: briefExampleRequest.portfolio,
      currency: 'USD',
      totalAmount: '100',
      orderType: 'BUY',
    };

    await request(app).post(ORDERS).set('Idempotency-Key', 'k').send(briefExampleRequest);
    const retry = await request(app).post(ORDERS).set('Idempotency-Key', 'k').send(reordered);
    expect(retry.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects reusing a key with a different body (422)', async () => {
    const { app } = buildTestApp();
    await request(app).post(ORDERS).set('Idempotency-Key', 'k').send(briefExampleRequest);

    const response = await request(app)
      .post(ORDERS)
      .set('Idempotency-Key', 'k')
      .send({ ...briefExampleRequest, totalAmount: '200' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('returns 409 while the first request with the key is still running', async () => {
    let releaseSave: () => void = () => undefined;
    const repository = new InMemoryOrderRepository();
    const slowRepository = {
      findById: repository.findById.bind(repository),
      list: repository.list.bind(repository),
      save: (order: Order) =>
        new Promise<void>((resolve) => {
          releaseSave = () => {
            void repository.save(order).then(resolve);
          };
        }),
    };
    const { app } = buildTestApp({}, { repository: slowRepository });

    const firstPending = request(app)
      .post(ORDERS)
      .set('Idempotency-Key', 'slow')
      .send(briefExampleRequest)
      .then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const concurrent = await request(app)
      .post(ORDERS)
      .set('Idempotency-Key', 'slow')
      .send(briefExampleRequest);
    expect(concurrent.status).toBe(409);
    expect(concurrent.body.error.code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');

    releaseSave();
    expect((await firstPending).status).toBe(201);
  });

  it('does not store failed requests, so the key can be reused after fixing the body', async () => {
    const { app } = buildTestApp();
    const invalid = await request(app)
      .post(ORDERS)
      .set('Idempotency-Key', 'k')
      .send({ ...briefExampleRequest, totalAmount: '-1' });
    const fixed = await request(app)
      .post(ORDERS)
      .set('Idempotency-Key', 'k')
      .send(briefExampleRequest);

    expect(invalid.status).toBe(400);
    expect(fixed.status).toBe(201);
    expect(fixed.headers['idempotent-replayed']).toBeUndefined();
  });

  it('scopes keys per partner', async () => {
    const keyA = 'key-for-partner-a-0123456789abcdef';
    const keyB = 'key-for-partner-b-0123456789abcdef';
    const { app } = buildTestApp({ API_KEYS: `a:${keyA},b:${keyB}` });

    const fromA = await request(app)
      .post(ORDERS)
      .set('X-API-Key', keyA)
      .set('Idempotency-Key', 'shared')
      .send(briefExampleRequest);
    const fromB = await request(app)
      .post(ORDERS)
      .set('X-API-Key', keyB)
      .set('Idempotency-Key', 'shared')
      .send({ ...briefExampleRequest, totalAmount: '500' });

    expect(fromB.status).toBe(201);
    expect(fromB.body.orderId).not.toBe(fromA.body.orderId);
  });

  it('creates separate orders when no key is sent', async () => {
    const { app } = buildTestApp();
    await request(app).post(ORDERS).send(briefExampleRequest);
    await request(app).post(ORDERS).send(briefExampleRequest);
    expect((await request(app).get(ORDERS)).body.pagination.total).toBe(2);
  });

  it('rejects a malformed key', async () => {
    const { app } = buildTestApp();
    const response = await request(app)
      .post(ORDERS)
      .set('Idempotency-Key', 'has spaces and /slashes')
      .send(briefExampleRequest);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].path).toBe('headers.idempotency-key');
  });
});
