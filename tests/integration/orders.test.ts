import request from 'supertest';
import type { OrderRepository } from '../../src/repositories/order.repository';
import { briefExampleRequest, withPartnerPrices } from '../fixtures/orders';
import { buildTestApp, fixedClock } from '../helpers/test-app';

const ORDERS = '/api/v1/orders';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Mon 2026-11-23 10:00 New York (market open)
const MONDAY_MARKET_HOURS = '2026-11-23T15:00:00.000Z';

describe('Orders API', () => {
  describe('POST /api/v1/orders', () => {
    it('creates the brief example: $60 AAPL / $40 TSLA with quantities and execution time', async () => {
      const { app } = buildTestApp({}, { clock: fixedClock(MONDAY_MARKET_HOURS) });

      const response = await request(app).post(ORDERS).send(briefExampleRequest);

      expect(response.status).toBe(201);
      expect(response.headers.location).toBe(`${ORDERS}/${response.body.orderId}`);
      expect(response.body).toEqual({
        orderId: expect.stringMatching(UUID),
        partnerId: 'anonymous',
        orderType: 'BUY',
        status: 'SCHEDULED',
        currency: 'USD',
        totalAmount: '100.00',
        quantityPrecision: 3,
        lines: [
          {
            symbol: 'AAPL',
            allocationPercent: '60',
            allocatedAmount: '60.00',
            price: '100.00',
            priceSource: 'DEFAULT',
            quantity: '0.600',
            estimatedValue: '60.00',
            residualAmount: '0.00',
          },
          {
            symbol: 'TSLA',
            allocationPercent: '40',
            allocatedAmount: '40.00',
            price: '100.00',
            priceSource: 'DEFAULT',
            quantity: '0.400',
            estimatedValue: '40.00',
            residualAmount: '0.00',
          },
        ],
        totals: { allocatedAmount: '100.00', estimatedValue: '100.00', residualAmount: '0.00' },
        execution: {
          executeAt: '2026-11-23T10:00:00.000-05:00',
          timeZone: 'America/New_York',
          reason: 'MARKET_OPEN',
        },
        warnings: [],
        createdAt: MONDAY_MARKET_HOURS,
      });
    });

    it('uses partner market prices over the default', async () => {
      const { app } = buildTestApp();
      const response = await request(app).post(ORDERS).send(withPartnerPrices);

      expect(response.status).toBe(201);
      expect(response.body.lines[0]).toMatchObject({
        price: '150.00',
        priceSource: 'PARTNER',
        quantity: '0.400',
      });
      expect(response.body.lines[1]).toMatchObject({ price: '100.00', priceSource: 'DEFAULT' });
    });

    it('applies the configured quantity precision', async () => {
      const { app } = buildTestApp({ QUANTITY_PRECISION: '7' });
      const response = await request(app)
        .post(ORDERS)
        .send({
          orderType: 'BUY',
          totalAmount: '100',
          portfolio: [{ symbol: 'X', allocation: '100', marketPrice: '3' }],
        });

      expect(response.body.quantityPrecision).toBe(7);
      expect(response.body.lines[0].quantity).toBe('33.3333333');
    });

    it('applies the configured default price', async () => {
      const { app } = buildTestApp({ DEFAULT_STOCK_PRICE: '50' });
      const response = await request(app).post(ORDERS).send(briefExampleRequest);
      expect(response.body.lines[0]).toMatchObject({ price: '50.00', quantity: '1.200' });
    });

    it('creates SELL orders', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .send({ ...briefExampleRequest, orderType: 'SELL' });

      expect(response.status).toBe(201);
      expect(response.body.orderType).toBe('SELL');
      expect(response.body.lines[0].quantity).toBe('0.600');
    });

    it('schedules weekend orders for Monday at the open', async () => {
      // Sat 2026-11-28 12:00 New York
      const { app } = buildTestApp({}, { clock: fixedClock('2026-11-28T17:00:00.000Z') });
      const response = await request(app).post(ORDERS).send(briefExampleRequest);

      expect(response.body.execution).toEqual({
        executeAt: '2026-11-30T09:30:00.000-05:00',
        timeZone: 'America/New_York',
        reason: 'WEEKEND',
      });
    });

    it('returns 400 with every validation problem listed', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .send({
          orderType: 'HOLD',
          totalAmount: '-5',
          portfolio: [
            { symbol: 'AAPL', allocation: '70', marketPrice: '0' },
            { symbol: 'aapl', allocation: '20' },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: expect.arrayContaining([
            expect.objectContaining({ path: 'orderType' }),
            expect.objectContaining({ path: 'totalAmount' }),
            expect.objectContaining({
              path: 'portfolio[0].marketPrice',
              message: 'must be greater than 0',
            }),
          ]),
        },
        requestId: expect.any(String),
      });
    });

    it('returns 400 when the allocations do not add up to 100', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .send({ ...briefExampleRequest, portfolio: [{ symbol: 'AAPL', allocation: '60' }] });

      expect(response.status).toBe(400);
      expect(response.body.error.details).toEqual([
        { path: 'portfolio', message: 'allocations must add up to exactly 100 (got 60)' },
      ]);
    });

    it('returns 400 INVALID_JSON for malformed JSON', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .set('Content-Type', 'application/json')
        .send('{"orderType": "BUY",');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_JSON');
    });

    it('returns 400 for an empty JSON body', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .set('Content-Type', 'application/json')
        .send('');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 415 when the body is not JSON', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .set('Content-Type', 'text/plain')
        .send('hello');

      expect(response.status).toBe(415);
      expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('returns 413 for an oversized body', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .send({ ...briefExampleRequest, padding: 'x'.repeat(200_000) });

      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('returns a generic 500 without leaking internals when storage fails', async () => {
      const failing: OrderRepository = {
        save: () => Promise.reject(new Error('disk on fire: secret connection string')),
        findById: () => Promise.resolve(undefined),
        list: () => Promise.resolve({ items: [], total: 0 }),
      };
      const { app, logs } = buildTestApp({}, { repository: failing });

      const response = await request(app).post(ORDERS).send(briefExampleRequest);

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [],
      });
      expect(JSON.stringify(response.body)).not.toMatch(/disk on fire|stack/);
      expect(logs.some((l) => l.msg === 'Unhandled error')).toBe(true);
    });
  });

  describe('GET /api/v1/orders', () => {
    it('returns an empty list when there are no orders', async () => {
      const { app } = buildTestApp();
      const response = await request(app).get(ORDERS);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
    });

    it('returns history newest first, with paging and an orderType filter', async () => {
      const { app } = buildTestApp();
      const created: string[] = [];
      for (const orderType of ['BUY', 'SELL', 'BUY', 'SELL', 'SELL']) {
        const res = await request(app)
          .post(ORDERS)
          .send({ ...briefExampleRequest, orderType });
        created.push(res.body.orderId as string);
      }
      const newestFirst = [...created].reverse();

      const all = await request(app).get(ORDERS);
      expect(all.body.data.map((o: { orderId: string }) => o.orderId)).toEqual(newestFirst);
      expect(all.body.pagination.total).toBe(5);

      const page = await request(app).get(ORDERS).query({ limit: 2, offset: 1 });
      expect(page.body.data.map((o: { orderId: string }) => o.orderId)).toEqual(
        newestFirst.slice(1, 3),
      );
      expect(page.body.pagination).toEqual({ limit: 2, offset: 1, total: 5 });

      const sells = await request(app).get(ORDERS).query({ orderType: 'SELL' });
      expect(sells.body.pagination.total).toBe(3);
      expect(sells.body.data.every((o: { orderType: string }) => o.orderType === 'SELL')).toBe(
        true,
      );
    });

    it.each([
      { limit: '0' },
      { limit: '500' },
      { offset: '-1' },
      { orderType: 'HOLD' },
      { foo: 'bar' },
    ])('returns 400 for invalid query %p', async (query) => {
      const { app } = buildTestApp();
      const response = await request(app).get(ORDERS).query(query);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/orders/:orderId', () => {
    it('returns a stored order', async () => {
      const { app } = buildTestApp();
      const created = await request(app).post(ORDERS).send(briefExampleRequest);

      const response = await request(app).get(`${ORDERS}/${created.body.orderId}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(created.body);
    });

    it('returns 404 for an unknown order', async () => {
      const { app } = buildTestApp();
      const response = await request(app).get(`${ORDERS}/3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f`);

      expect(response.status).toBe(404);
      expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('returns 400 for a malformed order id', async () => {
      const { app } = buildTestApp();
      const response = await request(app).get(`${ORDERS}/not-a-uuid`);

      expect(response.status).toBe(400);
      expect(response.body.error.details).toEqual([
        { path: 'orderId', message: 'must be a valid UUID' },
      ]);
    });
  });

  it('returns 404 JSON for unknown routes', async () => {
    const { app } = buildTestApp();
    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe('Route GET /api/v1/unknown not found');
  });

  it('data does not survive a restart (new app instance = empty history)', async () => {
    const first = buildTestApp();
    await request(first.app).post(ORDERS).send(briefExampleRequest);

    const restarted = buildTestApp();
    const response = await request(restarted.app).get(ORDERS);
    expect(response.body.pagination.total).toBe(0);
  });

  describe('observability', () => {
    it('logs each response time in milliseconds with method, route, status and request id', async () => {
      const { app, logs } = buildTestApp();
      const response = await request(app).post(ORDERS).send(briefExampleRequest);

      const entry = logs.find((l) => typeof l.durationMs === 'number');
      expect(entry).toMatchObject({
        method: 'POST',
        route: ORDERS,
        statusCode: 201,
        requestId: response.headers['x-request-id'],
      });
      expect(entry?.durationMs).toBeGreaterThanOrEqual(0);
      expect(entry?.msg).toMatch(/^POST \/api\/v1\/orders 201 \d+(\.\d+)?ms$/);
    });

    it('logs the route template, not the concrete id', async () => {
      const { app, logs } = buildTestApp();
      await request(app).get(`${ORDERS}/3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f`);
      expect(logs.find((l) => l.statusCode === 404)?.route).toBe(`${ORDERS}/:orderId`);
    });

    it('never logs request bodies', async () => {
      const { app, logs } = buildTestApp();
      await request(app).post(ORDERS).send(briefExampleRequest);
      expect(JSON.stringify(logs)).not.toMatch(/AAPL|portfolio|totalAmount/);
    });

    it('echoes a safe caller request id and replaces an unsafe one', async () => {
      const { app } = buildTestApp();

      const safe = await request(app).get('/health').set('X-Request-Id', 'partner-abc-123');
      expect(safe.headers['x-request-id']).toBe('partner-abc-123');

      const unsafe = await request(app).get('/health').set('X-Request-Id', 'bad id with spaces');
      expect(unsafe.headers['x-request-id']).toMatch(UUID);
    });
  });
});
