import request from 'supertest';
import { AppLifecycle } from '../../src/lib/lifecycle';
import { buildTestApp } from '../helpers/test-app';

describe('Health checks', () => {
  it.each(['/health', '/health/live'])('%s reports the process is alive', async (path) => {
    const { app } = buildTestApp();
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(typeof response.body.uptimeSeconds).toBe('number');
    expect(new Date(response.body.timestamp as string).toString()).not.toBe('Invalid Date');
  });

  it('/health/ready is 200 while serving traffic', async () => {
    const { app } = buildTestApp();
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
  });

  describe('while shutting down', () => {
    const lifecycle = new AppLifecycle();
    const { app } = buildTestApp({}, { lifecycle });
    lifecycle.startDraining();

    it('readiness fails so the load balancer stops sending traffic', async () => {
      const response = await request(app).get('/health/ready');
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('draining');
    });

    it('liveness still passes (do not restart a process that is shutting down cleanly)', async () => {
      expect((await request(app).get('/health/live')).status).toBe(200);
    });

    it('in-flight API requests are still served but ask clients to close the connection', async () => {
      const response = await request(app).get('/api/v1/orders').set('Connection', 'keep-alive');
      expect(response.status).toBe(200);
      expect(response.headers.connection).toBe('close');
    });
  });

  it('does not ask clients to close connections during normal operation', async () => {
    const { app } = buildTestApp();
    const response = await request(app).get('/api/v1/orders').set('Connection', 'keep-alive');
    expect(response.headers.connection).toBe('keep-alive');
  });

  it('logs a plain route template for each health path, including 405s', async () => {
    const { app, logs } = buildTestApp();
    await request(app).get('/health');
    await request(app).get('/health/live');
    await request(app).post('/health/ready');

    expect(
      logs.filter((l) => typeof l.route === 'string').map((l) => [l.route, l.statusCode]),
    ).toEqual([
      ['/health', 200],
      ['/health/live', 200],
      ['/health/ready', 405],
    ]);
  });
});
