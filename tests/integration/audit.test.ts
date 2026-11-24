import request from 'supertest';
import { briefExampleRequest } from '../fixtures/orders';
import { buildTestApp, type LogEntry } from '../helpers/test-app';

const KEY = 'key-for-partner-a-0123456789abcdef';
const ORDERS = '/api/v1/orders';
const auditEvents = (logs: LogEntry[]) => logs.filter((l) => l.audit === true);

describe('Audit events', () => {
  it('records order.created with identifiers only (no amounts or symbols)', async () => {
    const { app, logs } = buildTestApp({ API_KEYS: `partner-a:${KEY}` });
    const response = await request(app)
      .post(ORDERS)
      .set('X-API-Key', KEY)
      .send(briefExampleRequest);

    const event = auditEvents(logs).find((l) => l.event === 'order.created');
    expect(event).toMatchObject({
      orderId: response.body.orderId,
      partnerId: 'partner-a',
      orderType: 'BUY',
      lineCount: 2,
      executeAt: response.body.execution.executeAt,
    });
    expect(JSON.stringify(event)).not.toMatch(/AAPL|100\.00|totalAmount/);
  });

  it.each([
    ['missing_key', undefined],
    ['invalid_key', 'wrong-key'],
  ])('records auth.failed (%s) without the presented key', async (reason, key) => {
    const { app, logs } = buildTestApp({ API_KEYS: `partner-a:${KEY}` });
    const req = request(app).get(ORDERS);
    const response = await (key === undefined ? req : req.set('X-API-Key', key));

    const event = auditEvents(logs).find((l) => l.event === 'auth.failed');
    expect(event).toMatchObject({
      reason,
      route: ORDERS,
      requestId: response.headers['x-request-id'],
    });
    expect(typeof event?.clientIp).toBe('string');
    expect(JSON.stringify(logs)).not.toContain('wrong-key');
  });

  it('records rate_limit.exceeded', async () => {
    const { app, logs } = buildTestApp({ RATE_LIMIT_MAX: '1' });
    await request(app).get(ORDERS);
    await request(app).get(ORDERS);

    expect(auditEvents(logs).find((l) => l.event === 'rate_limit.exceeded')).toMatchObject({
      scope: 'ip',
    });
  });

  it('records idempotency replays and conflicts', async () => {
    const { app, logs } = buildTestApp();
    const send = (body: object) =>
      request(app).post(ORDERS).set('Idempotency-Key', 'idem-1').send(body);

    await send(briefExampleRequest);
    await send(briefExampleRequest);
    await send({ ...briefExampleRequest, totalAmount: '7' });

    const events = auditEvents(logs).map((l) => [l.event, l.reason]);
    expect(events).toEqual(
      expect.arrayContaining([
        ['idempotency.replayed', undefined],
        ['idempotency.conflict', 'different_body'],
      ]),
    );
  });
});
