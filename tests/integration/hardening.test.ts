import request from 'supertest';
import { createLogger } from '../../src/lib/logger';
import { briefExampleRequest } from '../fixtures/orders';
import { buildTestApp } from '../helpers/test-app';

const ORDERS = '/api/v1/orders';

describe('Method handling', () => {
  const { app } = buildTestApp();

  it.each([
    ['delete', ORDERS, 'GET, POST, HEAD, OPTIONS'],
    ['put', ORDERS, 'GET, POST, HEAD, OPTIONS'],
    ['patch', `${ORDERS}/3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f`, 'GET, HEAD, OPTIONS'],
    ['post', '/health/ready', 'GET, HEAD, OPTIONS'],
  ] as const)('%s %s -> 405 with an Allow header', async (method, path, allow) => {
    const response = await request(app)[method](path);

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe(allow);
    expect(response.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('answers OPTIONS with 204 and the allowed methods, without CORS headers', async () => {
    const response = await request(app).options(ORDERS);

    expect(response.status).toBe(204);
    expect(response.headers.allow).toBe('GET, POST, HEAD, OPTIONS');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('still supports HEAD on GET routes', async () => {
    expect((await request(app).head(ORDERS)).status).toBe(200);
  });
});

describe('Prototype pollution', () => {
  const sendRaw = (app: Parameters<typeof request>[0], json: string) =>
    request(app).post(ORDERS).set('Content-Type', 'application/json').send(json);

  afterEach(() => {
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a top-level __proto__ key', async () => {
    const { app } = buildTestApp();
    const body = JSON.stringify(briefExampleRequest).replace(
      /^\{/,
      '{"__proto__":{"polluted":true},',
    );
    const response = await sendRaw(app, body);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toMatch(/unknown field\(s\): __proto__/);
  });

  it('rejects constructor/prototype keys inside a portfolio item', async () => {
    const { app } = buildTestApp();
    const body = JSON.stringify({
      ...briefExampleRequest,
      portfolio: [
        { symbol: 'AAPL', allocation: '60', constructor: { prototype: { polluted: true } } },
        { symbol: 'TSLA', allocation: '40' },
      ],
    });
    const response = await sendRaw(app, body);

    expect(response.status).toBe(400);
    expect(response.body.error.details[0]).toMatchObject({ path: 'portfolio[0]' });
  });
});

describe('Log redaction', () => {
  it('masks credentials even if a future change logs request headers', () => {
    const lines: string[] = [];
    const logger = createLogger('info', { write: (line: string) => lines.push(line) });

    logger.info({
      req: { headers: { 'x-api-key': 'secret-1', authorization: 'Bearer secret-2' } },
    });
    logger.info({ apiKey: 'secret-3', partner: { apiKey: 'secret-4' } });

    const output = lines.join('\n');
    expect(output).not.toMatch(/secret-\d/);
    expect(output).toContain('[Redacted]');
  });
});
