import request from 'supertest';
import { buildTestApp } from '../helpers/test-app';

describe('Rate limiting', () => {
  it('returns 429 with Retry-After once the limit is reached', async () => {
    const { app } = buildTestApp({ RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' });

    const first = await request(app).get('/api/v1/orders');
    const second = await request(app).get('/api/v1/orders');
    const third = await request(app).get('/api/v1/orders');

    expect([first.status, second.status]).toEqual([200, 200]);
    // IETF draft-8 headers, e.g. RateLimit: "ip"; r=1; t=60, "partner"; r=599; t=60
    expect(first.headers.ratelimit).toMatch(/"ip"; r=1; t=\d+/);
    expect(first.headers['ratelimit-policy']).toMatch(/q=2; w=60/);
    expect(third.status).toBe(429);
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(third.body.requestId).toEqual(expect.any(String));
  });

  it('counts failed authentication attempts too (slows down key guessing)', async () => {
    const { app } = buildTestApp({
      RATE_LIMIT_MAX: '2',
      API_KEYS: 'partner-a:key-for-partner-a-0123456789abcdef',
    });

    await request(app).get('/api/v1/orders').set('X-API-Key', 'guess-1');
    await request(app).get('/api/v1/orders').set('X-API-Key', 'guess-2');
    const third = await request(app).get('/api/v1/orders').set('X-API-Key', 'guess-3');

    expect(third.status).toBe(429);
  });

  it('does not rate-limit health checks', async () => {
    const { app } = buildTestApp({ RATE_LIMIT_MAX: '1' });
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
  });
});

describe('Per-partner quota', () => {
  const KEY_A = 'key-for-partner-a-0123456789abcdef';
  const KEY_B = 'key-for-partner-b-0123456789abcdef';

  it('limits each partner separately, even from the same IP', async () => {
    const { app } = buildTestApp({
      API_KEYS: `a:${KEY_A},b:${KEY_B}`,
      RATE_LIMIT_MAX: '100',
      PARTNER_RATE_LIMIT_MAX: '2',
    });
    const get = (key: string) => request(app).get('/api/v1/orders').set('X-API-Key', key);

    expect((await get(KEY_A)).status).toBe(200);
    expect((await get(KEY_A)).status).toBe(200);
    const third = await get(KEY_A);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('PARTNER_QUOTA_EXCEEDED');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);

    expect((await get(KEY_B)).status).toBe(200);
  });

  it('reports both the IP and the partner policies in the response headers', async () => {
    const { app } = buildTestApp({ API_KEYS: `a:${KEY_A}` });
    const response = await request(app).get('/api/v1/orders').set('X-API-Key', KEY_A);
    expect(response.headers['ratelimit-policy']).toMatch(/"ip"/);
    expect(response.headers['ratelimit-policy']).toMatch(/"partner"/);
  });
});

describe('Body parsing happens after rate limiting and authentication', () => {
  const KEY = 'key-for-partner-a-0123456789abcdef';

  it('unauthenticated malformed bodies get 401 (not 400) and count towards the IP limit', async () => {
    const { app, logs } = buildTestApp({ API_KEYS: `a:${KEY}`, RATE_LIMIT_MAX: '2' });
    const sendBroken = () =>
      request(app).post('/api/v1/orders').set('Content-Type', 'application/json').send('{bad');

    const first = await sendBroken();
    const second = await sendBroken();
    const third = await sendBroken();

    expect([first.status, second.status]).toEqual([401, 401]);
    expect(third.status).toBe(429);
    expect(logs.filter((l) => l.event === 'auth.failed')).toHaveLength(2);
  });

  it('unauthenticated oversized bodies are rejected with 401 before being parsed', async () => {
    const { app } = buildTestApp({ API_KEYS: `a:${KEY}` });
    const response = await request(app)
      .post('/api/v1/orders')
      .send({ padding: 'x'.repeat(200_000) });
    expect(response.status).toBe(401);
  });

  it('authenticated callers still get precise body errors', async () => {
    const { app } = buildTestApp({ API_KEYS: `a:${KEY}` });
    const response = await request(app)
      .post('/api/v1/orders')
      .set('X-API-Key', KEY)
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });
});
