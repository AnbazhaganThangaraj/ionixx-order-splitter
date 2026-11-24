import request from 'supertest';
import { buildTestApp } from '../helpers/test-app';

describe('Rate limiting', () => {
  it('returns 429 with Retry-After once the limit is reached', async () => {
    const { app } = buildTestApp({ RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' });

    const first = await request(app).get('/api/v1/orders');
    const second = await request(app).get('/api/v1/orders');
    const third = await request(app).get('/api/v1/orders');

    expect([first.status, second.status]).toEqual([200, 200]);
    // IETF draft-8 headers, e.g. RateLimit: "2-in-1min"; r=1; t=60
    expect(first.headers.ratelimit).toMatch(/; r=1; t=\d+$/);
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
