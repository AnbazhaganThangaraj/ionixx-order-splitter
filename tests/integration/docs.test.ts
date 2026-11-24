import request from 'supertest';
import { buildTestApp } from '../helpers/test-app';

describe('API docs', () => {
  const { app } = buildTestApp({ QUANTITY_PRECISION: '5' });

  it('serves the OpenAPI document', async () => {
    const response = await request(app).get('/docs/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(Object.keys(response.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/orders',
        '/api/v1/orders/{orderId}',
        '/health/live',
        '/health/ready',
      ]),
    );
    expect(response.body.components.securitySchemes.ApiKeyAuth).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
    expect(Object.keys(response.body.paths['/api/v1/orders'].post.responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '409', '422', '429']),
    );
    expect(response.body.info.description).toMatch(/quantity precision 5 decimal places/);
  });

  it('serves the Swagger UI', async () => {
    const response = await request(app).get('/docs/').redirects(1);
    expect(response.status).toBe(200);
    expect(response.text).toMatch(/swagger-ui/i);
  });

  it('logs the real path for Swagger UI requests, not the router-relative "/"', async () => {
    const { app: docsApp, logs } = buildTestApp();
    await request(docsApp).get('/docs/');
    expect(logs.find((l) => typeof l.route === 'string')?.route).toBe('/docs/');
  });
});
