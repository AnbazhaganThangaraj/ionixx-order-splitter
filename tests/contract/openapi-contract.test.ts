import request from 'supertest';
import { ERROR_CODES } from '../../src/errors/error-codes';
import { AppLifecycle } from '../../src/lib/lifecycle';
import type { IdempotencyStore } from '../../src/repositories/idempotency.store';
import type { OrderRepository } from '../../src/repositories/order.repository';
import {
  coveredResponses,
  documentedResponses,
  expectErrorShape,
  expectToMatchContract,
  seenErrorCodes,
} from '../helpers/contract';
import { briefExampleRequest, withPartnerPrices } from '../fixtures/orders';
import { buildTestApp } from '../helpers/test-app';

const ORDERS = '/api/v1/orders';
const ORDER_BY_ID = '/api/v1/orders/{orderId}';
const KEY = 'key-for-partner-a-0123456789abcdef';
const UNKNOWN_ID = '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f';

const failingRepository: OrderRepository = {
  save: () => Promise.reject(new Error('storage down')),
  findById: () => Promise.reject(new Error('storage down')),
  list: () => Promise.reject(new Error('storage down')),
};

describe('OpenAPI contract', () => {
  describe('POST /api/v1/orders', () => {
    it('201: default prices', async () => {
      const { app } = buildTestApp();
      expectToMatchContract(
        await request(app).post(ORDERS).send(briefExampleRequest),
        'post',
        ORDERS,
      );
    });

    it('201: partner prices, SELL, warnings and residual cash', async () => {
      const { app } = buildTestApp({ QUANTITY_PRECISION: '0' });
      const response = await request(app)
        .post(ORDERS)
        .send({
          ...withPartnerPrices,
          orderType: 'SELL',
          totalAmount: '1000.00',
          portfolio: [
            { symbol: 'AAPL', allocation: '99', marketPrice: '187.43' },
            { symbol: 'TINY', allocation: '1', marketPrice: '5000' },
          ],
        });
      expect(response.body.warnings).toHaveLength(1);
      expectToMatchContract(response, 'post', ORDERS);
    });

    it('201: replayed with Idempotency-Key', async () => {
      const { app } = buildTestApp();
      await request(app).post(ORDERS).set('Idempotency-Key', 'c-1').send(briefExampleRequest);
      const replay = await request(app)
        .post(ORDERS)
        .set('Idempotency-Key', 'c-1')
        .send(briefExampleRequest);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expectToMatchContract(replay, 'post', ORDERS);
    });

    it.each([
      ['VALIDATION_ERROR', (r: request.Test) => r.send({ orderType: 'HOLD' })],
      [
        'INVALID_JSON',
        (r: request.Test) => r.set('Content-Type', 'application/json').send('{"broken":'),
      ],
      [
        'BAD_REQUEST',
        (r: request.Test) =>
          r.set('Content-Type', 'application/json').set('Content-Encoding', 'br').send('{}'),
      ],
    ])('400: %s', async (code, send) => {
      const { app } = buildTestApp();
      const response = await send(request(app).post(ORDERS));
      expect(response.body.error.code).toBe(code);
      expectToMatchContract(response, 'post', ORDERS);
    });

    it('401: missing API key', async () => {
      const { app } = buildTestApp({ API_KEYS: `a:${KEY}` });
      expectToMatchContract(
        await request(app).post(ORDERS).send(briefExampleRequest),
        'post',
        ORDERS,
      );
    });

    it('409: idempotent request still in progress', async () => {
      const busyStore: IdempotencyStore = {
        begin: () => Promise.resolve({ kind: 'in-progress' }),
        complete: () => Promise.resolve(),
        release: () => Promise.resolve(),
      };
      const { app } = buildTestApp({}, { idempotencyStore: busyStore });
      const response = await request(app)
        .post(ORDERS)
        .set('Idempotency-Key', 'busy')
        .send(briefExampleRequest);
      expectToMatchContract(response, 'post', ORDERS);
    });

    it('413: body too large', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .send({ ...briefExampleRequest, padding: 'x'.repeat(200_000) });
      expectToMatchContract(response, 'post', ORDERS);
    });

    it('415: not JSON', async () => {
      const { app } = buildTestApp();
      const response = await request(app).post(ORDERS).set('Content-Type', 'text/plain').send('x');
      expectToMatchContract(response, 'post', ORDERS);
    });

    it('422: Idempotency-Key reused with another body', async () => {
      const { app } = buildTestApp();
      await request(app).post(ORDERS).set('Idempotency-Key', 'c-2').send(briefExampleRequest);
      const response = await request(app)
        .post(ORDERS)
        .set('Idempotency-Key', 'c-2')
        .send({ ...briefExampleRequest, totalAmount: '9' });
      expectToMatchContract(response, 'post', ORDERS);
    });

    it('429: IP rate limit and partner quota', async () => {
      const ip = buildTestApp({ RATE_LIMIT_MAX: '1' });
      await request(ip.app).post(ORDERS).send(briefExampleRequest);
      const limited = await request(ip.app).post(ORDERS).send(briefExampleRequest);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expectToMatchContract(limited, 'post', ORDERS);

      const partner = buildTestApp({ API_KEYS: `a:${KEY}`, PARTNER_RATE_LIMIT_MAX: '1' });
      await request(partner.app).post(ORDERS).set('X-API-Key', KEY).send(briefExampleRequest);
      const quota = await request(partner.app)
        .post(ORDERS)
        .set('X-API-Key', KEY)
        .send(briefExampleRequest);
      expect(quota.body.error.code).toBe('PARTNER_QUOTA_EXCEEDED');
      expectToMatchContract(quota, 'post', ORDERS);
    });

    it('500: unexpected failure', async () => {
      const { app } = buildTestApp({}, { repository: failingRepository });
      expectToMatchContract(
        await request(app).post(ORDERS).send(briefExampleRequest),
        'post',
        ORDERS,
      );
    });
  });

  describe('GET /api/v1/orders', () => {
    it('200: empty and populated pages', async () => {
      const { app } = buildTestApp();
      expectToMatchContract(await request(app).get(ORDERS), 'get', ORDERS);
      await request(app).post(ORDERS).send(briefExampleRequest);
      expectToMatchContract(await request(app).get(ORDERS).query({ limit: 1 }), 'get', ORDERS);
    });

    it('400, 401, 429 and 500', async () => {
      expectToMatchContract(
        await request(buildTestApp().app).get(ORDERS).query({ limit: 0 }),
        'get',
        ORDERS,
      );
      expectToMatchContract(
        await request(buildTestApp({ API_KEYS: `a:${KEY}` }).app).get(ORDERS),
        'get',
        ORDERS,
      );
      const limited = buildTestApp({ RATE_LIMIT_MAX: '1' });
      await request(limited.app).get(ORDERS);
      expectToMatchContract(await request(limited.app).get(ORDERS), 'get', ORDERS);
      expectToMatchContract(
        await request(buildTestApp({}, { repository: failingRepository }).app).get(ORDERS),
        'get',
        ORDERS,
      );
    });
  });

  describe('GET /api/v1/orders/{orderId}', () => {
    it('200, 400, 401, 404, 429 and 500', async () => {
      const { app } = buildTestApp();
      const created = await request(app).post(ORDERS).send(briefExampleRequest);
      expectToMatchContract(
        await request(app).get(`${ORDERS}/${created.body.orderId}`),
        'get',
        ORDER_BY_ID,
      );
      expectToMatchContract(await request(app).get(`${ORDERS}/nope`), 'get', ORDER_BY_ID);
      expectToMatchContract(await request(app).get(`${ORDERS}/${UNKNOWN_ID}`), 'get', ORDER_BY_ID);
      expectToMatchContract(
        await request(buildTestApp({ API_KEYS: `a:${KEY}` }).app).get(`${ORDERS}/${UNKNOWN_ID}`),
        'get',
        ORDER_BY_ID,
      );
      const limited = buildTestApp({ RATE_LIMIT_MAX: '1' });
      await request(limited.app).get(`${ORDERS}/${UNKNOWN_ID}`);
      expectToMatchContract(
        await request(limited.app).get(`${ORDERS}/${UNKNOWN_ID}`),
        'get',
        ORDER_BY_ID,
      );
      expectToMatchContract(
        await request(buildTestApp({}, { repository: failingRepository }).app).get(
          `${ORDERS}/${UNKNOWN_ID}`,
        ),
        'get',
        ORDER_BY_ID,
      );
    });
  });

  describe('health', () => {
    it('live 200, ready 200 and ready 503 while draining', async () => {
      const { app } = buildTestApp();
      expectToMatchContract(await request(app).get('/health/live'), 'get', '/health/live');
      expectToMatchContract(await request(app).get('/health/ready'), 'get', '/health/ready');

      const lifecycle = new AppLifecycle();
      const draining = buildTestApp({}, { lifecycle });
      lifecycle.startDraining();
      expectToMatchContract(
        await request(draining.app).get('/health/ready'),
        'get',
        '/health/ready',
      );
    });
  });

  describe('responses outside documented operations', () => {
    it('unknown route (404) and wrong method (405) use the documented Error shape', async () => {
      const { app } = buildTestApp();
      expectErrorShape(await request(app).get('/api/v1/nothing-here'));
      expectErrorShape(await request(app).delete(ORDERS));
    });
  });

  afterAll(() => {
    // Every documented response has been produced by a real request in this file...
    expect(documentedResponses().filter((r) => !coveredResponses.has(r))).toEqual([]);
    // ...and every error code in the catalogue has actually been returned.
    expect([...ERROR_CODES].filter((code) => !seenErrorCodes.has(code))).toEqual([]);
  });
});
