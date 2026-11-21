import request from 'supertest';
import { buildTestApp } from '../helpers/test-app';

describe('GET /health', () => {
  const { app } = buildTestApp();

  it('returns 200 with process status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(typeof response.body.uptimeSeconds).toBe('number');
    expect(new Date(response.body.timestamp as string).toString()).not.toBe('Invalid Date');
  });

  it('does not advertise the framework', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
