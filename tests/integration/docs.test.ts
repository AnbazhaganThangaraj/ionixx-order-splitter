import request from 'supertest';
import { buildTestApp } from '../helpers/test-app';

describe('API docs', () => {
  const { app } = buildTestApp({ QUANTITY_PRECISION: '5' });

  it('serves the OpenAPI document', async () => {
    const response = await request(app).get('/docs/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(Object.keys(response.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/orders', '/api/v1/orders/{orderId}', '/health']),
    );
    expect(response.body.info.description).toMatch(/quantity precision 5 decimal places/);
  });

  it('serves the Swagger UI', async () => {
    const response = await request(app).get('/docs/').redirects(1);
    expect(response.status).toBe(200);
    expect(response.text).toMatch(/swagger-ui/i);
  });
});
