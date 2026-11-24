import request from 'supertest';
import { briefExampleRequest } from '../fixtures/orders';
import { buildTestApp } from '../helpers/test-app';

describe('Security headers', () => {
  const { app } = buildTestApp();

  it('sets hardening headers on API responses', async () => {
    const response = await request(app).post('/api/v1/orders').send(briefExampleRequest);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('marks order data as not cacheable', async () => {
    const created = await request(app).post('/api/v1/orders').send(briefExampleRequest);
    const listed = await request(app).get('/api/v1/orders');

    expect(created.headers['cache-control']).toBe('no-store');
    expect(listed.headers['cache-control']).toBe('no-store');
  });

  it('also protects error responses', async () => {
    const response = await request(app).get('/api/v1/orders/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('uses a looser policy for the Swagger UI page only', async () => {
    const response = await request(app).get('/docs/').redirects(1);
    const csp = response.headers['content-security-policy'];

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('Proxy awareness (TRUST_PROXY)', () => {
  const clientIpLogged = async (env: Record<string, string>): Promise<unknown> => {
    const { app, logs } = buildTestApp(env);
    await request(app).get('/health').set('X-Forwarded-For', '203.0.113.7');
    return logs.find((l) => l.route === '/health')?.clientIp;
  };

  it('ignores X-Forwarded-For by default so it cannot be spoofed', async () => {
    expect(await clientIpLogged({})).not.toBe('203.0.113.7');
  });

  it('uses X-Forwarded-For when running behind a trusted proxy', async () => {
    expect(await clientIpLogged({ TRUST_PROXY: '1' })).toBe('203.0.113.7');
  });
});
