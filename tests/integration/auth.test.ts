import request from 'supertest';
import { hashApiKey } from '../../src/config/app.config';
import { briefExampleRequest } from '../fixtures/orders';
import { buildTestApp } from '../helpers/test-app';

const KEY_A = 'key-for-partner-a-0123456789abcdef';
const KEY_A_ROTATED = 'rotated-key-partner-a-0123456789ab';
const KEY_B = 'key-for-partner-b-0123456789abcdef';
const ORDERS = '/api/v1/orders';

const secured = () =>
  buildTestApp({ API_KEYS: `partner-a:${KEY_A},partner-a:${KEY_A_ROTATED},partner-b:${KEY_B}` });

describe('API key authentication', () => {
  it('rejects requests without an API key', async () => {
    const { app } = secured();
    const response = await request(app).get(ORDERS);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('ApiKey header="X-API-Key"');
    expect(response.body.error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'API key is missing: send your key in the X-API-Key header',
      details: [],
    });
  });

  it.each(['wrong-key', '', KEY_A.slice(0, -1), `${KEY_A}x`, KEY_A.toUpperCase()])(
    'rejects an invalid API key (%p)',
    async (key) => {
      const { app } = secured();
      const response = await request(app)
        .post(ORDERS)
        .set('X-API-Key', key)
        .send(briefExampleRequest);
      expect(response.status).toBe(401);
    },
  );

  it('authenticates before validating, so unauthenticated callers learn nothing', async () => {
    const { app } = secured();
    const response = await request(app).post(ORDERS).send({ nonsense: true });
    expect(response.status).toBe(401);
  });

  it('accepts a valid key and records the partner on the order', async () => {
    const { app } = secured();
    const response = await request(app)
      .post(ORDERS)
      .set('X-API-Key', KEY_A)
      .send(briefExampleRequest);

    expect(response.status).toBe(201);
    expect(response.body.partnerId).toBe('partner-a');
  });

  it('supports several keys per partner (key rotation)', async () => {
    const { app } = secured();
    const created = await request(app)
      .post(ORDERS)
      .set('X-API-Key', KEY_A)
      .send(briefExampleRequest);
    const fetched = await request(app)
      .get(`${ORDERS}/${created.body.orderId}`)
      .set('X-API-Key', KEY_A_ROTATED);

    expect(fetched.status).toBe(200);
  });

  it("keeps each partner's orders private", async () => {
    const { app } = secured();
    const created = await request(app)
      .post(ORDERS)
      .set('X-API-Key', KEY_A)
      .send(briefExampleRequest);

    const otherPartnerGet = await request(app)
      .get(`${ORDERS}/${created.body.orderId}`)
      .set('X-API-Key', KEY_B);
    expect(otherPartnerGet.status).toBe(404);

    const otherPartnerList = await request(app).get(ORDERS).set('X-API-Key', KEY_B);
    expect(otherPartnerList.body.pagination.total).toBe(0);

    const ownList = await request(app).get(ORDERS).set('X-API-Key', KEY_A);
    expect(ownList.body.pagination.total).toBe(1);
  });

  it('logs the partner id but never the API key', async () => {
    const { app, logs } = secured();
    await request(app).post(ORDERS).set('X-API-Key', KEY_A).send(briefExampleRequest);

    expect(logs.find((l) => l.route === ORDERS)?.partnerId).toBe('partner-a');
    expect(JSON.stringify(logs)).not.toContain(KEY_A);
  });

  it('leaves health checks and API docs public', async () => {
    const { app } = secured();
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/docs/openapi.json')).status).toBe(200);
  });

  it('authenticates partners configured by hash only (API_KEY_HASHES)', async () => {
    const { app } = buildTestApp({ API_KEY_HASHES: `partner-h:${hashApiKey(KEY_A)}` });
    const response = await request(app).get(ORDERS).set('X-API-Key', KEY_A);
    expect(response.status).toBe(200);
  });

  it('is disabled when no keys are configured (local development)', async () => {
    const { app } = buildTestApp();
    const response = await request(app).post(ORDERS).send(briefExampleRequest);
    expect(response.status).toBe(201);
    expect(response.body.partnerId).toBe('anonymous');
  });
});
