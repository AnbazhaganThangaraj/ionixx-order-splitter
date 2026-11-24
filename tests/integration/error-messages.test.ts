import request from 'supertest';
import { briefExampleRequest } from '../fixtures/orders';
import { buildTestApp } from '../helpers/test-app';

/**
 * One test per failure case, pinning the status, the machine-readable code and the
 * human-readable guidance a partner's developer sees.
 */
const ORDERS = '/api/v1/orders';
const KEY = 'key-for-partner-a-0123456789abcdef';

const post = (body: unknown, env: Record<string, string> = {}) =>
  request(buildTestApp(env).app)
    .post(ORDERS)
    .send(body as object);

const detail = (response: request.Response, path: string): string | undefined =>
  (response.body.error.details as { path: string; message: string }[]).find((d) => d.path === path)
    ?.message;

describe('Error messages by use case', () => {
  describe('request body format', () => {
    it('malformed JSON: says it is not JSON and where it breaks', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .set('Content-Type', 'application/json')
        .send('{"orderType": "BUY",, }');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_JSON');
      expect(response.body.error.message).toBe(
        'Request body is not valid JSON; send a JSON object',
      );
      expect(detail(response, 'body')).toMatch(/position \d+/);
    });

    it('empty body: lists every required field', async () => {
      const { app } = buildTestApp();
      const response = await request(app).post(ORDERS).set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error.details).toEqual([
        { path: 'orderType', message: 'is required (one of BUY, SELL)' },
        { path: 'totalAmount', message: 'is required (a decimal string such as "100.50")' },
        {
          path: 'portfolio',
          message: 'is required (an array of { symbol, allocation, marketPrice? } objects)',
        },
      ]);
    });

    it('body is a bare JSON string: rejected as invalid JSON, asking for an object', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .set('Content-Type', 'application/json')
        .send('"hello"');
      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON; send a JSON object',
      });
    });

    it('missing Content-Type: says so', async () => {
      const { app } = buildTestApp();
      const response = await request(app).post(ORDERS).unset('Content-Type').send();
      expect(response.status).toBe(415);
      expect(response.body.error.message).toBe(
        'Content-Type must be application/json (no Content-Type header was sent)',
      );
    });

    it('wrong Content-Type: echoes what was received', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .set('Content-Type', 'text/plain')
        .send('hello');
      expect(response.status).toBe(415);
      expect(response.body.error.message).toBe(
        'Content-Type must be application/json (got "text/plain")',
      );
    });

    it('unsupported charset: 415 asking for UTF-8 (not a vague 400)', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .set('Content-Type', 'application/json; charset=latin1')
        .send('{}');
      expect(response.status).toBe(415);
      expect(response.body.error).toMatchObject({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Unsupported charset "LATIN1"; send JSON encoded as UTF-8',
      });
    });

    it('unsupported Content-Encoding: 415 listing the supported encodings', async () => {
      const { app } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'compress')
        .send('{}');
      expect(response.status).toBe(415);
      expect(response.body.error.message).toBe(
        'Unsupported Content-Encoding "compress"; use gzip, deflate, br or none',
      );
    });

    it('corrupt compressed body: 400 BAD_REQUEST, never a 500', async () => {
      const { app, logs } = buildTestApp();
      const response = await request(app)
        .post(ORDERS)
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'br')
        .send('{"not":"brotli"}');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(response.body.error.message).toMatch(/^Request body could not be read: /);
      expect(logs.some((l) => l.msg === 'Unhandled error')).toBe(false);
    });

    it('oversized body: states the limit', async () => {
      const response = await post({ ...briefExampleRequest, padding: 'x'.repeat(200_000) });
      expect(response.status).toBe(413);
      expect(response.body.error.message).toBe('Request body is too large (limit 100kb)');
    });
  });

  describe('field validation', () => {
    it('reports how many problems were found', async () => {
      const response = await post({ orderType: 'HOLD', totalAmount: '-1', portfolio: [] });
      expect(response.body.error.message).toBe(
        'Request validation failed: 3 problems found (see details)',
      );
    });

    it.each([
      [
        { totalAmount: '100', portfolio: briefExampleRequest.portfolio },
        'orderType',
        'is required (one of BUY, SELL)',
      ],
      [
        { ...briefExampleRequest, orderType: 'buy' },
        'orderType',
        'must be one of BUY, SELL (got "buy")',
      ],
      [
        { ...briefExampleRequest, currency: 'EUR' },
        'currency',
        'must be USD (the only supported currency) (got "EUR")',
      ],
      [
        { ...briefExampleRequest, totalAmount: undefined },
        'totalAmount',
        'is required (a decimal string such as "100.50")',
      ],
      [
        { ...briefExampleRequest, totalAmount: true },
        'totalAmount',
        'must be a decimal string such as "100.50" (got boolean)',
      ],
      [
        { ...briefExampleRequest, totalAmount: '1,000' },
        'totalAmount',
        'must be a positive decimal number such as "100.50" (got "1,000"; no signs, exponents, commas or spaces)',
      ],
      [
        { ...briefExampleRequest, totalAmount: '10.123' },
        'totalAmount',
        'must have at most 2 decimal places (got 3)',
      ],
      [{ ...briefExampleRequest, totalAmount: '0' }, 'totalAmount', 'must be greater than 0'],
      [
        { ...briefExampleRequest, portfolio: undefined },
        'portfolio',
        'is required (an array of { symbol, allocation, marketPrice? } objects)',
      ],
      [{ ...briefExampleRequest, portfolio: [] }, 'portfolio', 'must contain at least one stock'],
      [
        { ...briefExampleRequest, portfolio: ['AAPL'] },
        'portfolio[0]',
        'must be an object with symbol and allocation (got "AAPL")',
      ],
      [
        { ...briefExampleRequest, portfolio: [{ allocation: '100' }] },
        'portfolio[0].symbol',
        'is required (a ticker string such as "AAPL")',
      ],
    ])('%#: %s -> %s: %s', async (body, path, message) => {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(detail(response, path)).toBe(message);
    });

    it('allocations over 100: says by how much', async () => {
      const response = await post({
        ...briefExampleRequest,
        portfolio: [
          { symbol: 'AAPL', allocation: '70' },
          { symbol: 'TSLA', allocation: '40.5' },
        ],
      });
      expect(detail(response, 'portfolio')).toBe(
        'allocations must add up to exactly 100 (got 110.5, 10.5 over)',
      );
    });

    it('duplicate symbol: points at both entries and suggests the fix', async () => {
      const response = await post({
        ...briefExampleRequest,
        portfolio: [
          { symbol: 'AAPL', allocation: '50' },
          { symbol: 'aapl', allocation: '50' },
        ],
      });
      expect(detail(response, 'portfolio[1].symbol')).toBe(
        'duplicate symbol "AAPL" (already at portfolio[0]); combine them into one entry',
      );
    });

    it('unknown field: names it and lists the allowed fields', async () => {
      const response = await post({
        ...briefExampleRequest,
        portfolio: [
          { symbol: 'AAPL', allocation: '60', markePrice: '150' },
          { symbol: 'TSLA', allocation: '40' },
        ],
      });
      expect(detail(response, 'portfolio[0]')).toBe(
        'unknown field(s): markePrice; allowed fields: symbol, allocation, marketPrice',
      );
    });

    it('long invalid values are truncated, not echoed in full', async () => {
      const response = await post({ ...briefExampleRequest, totalAmount: 'x'.repeat(500) });
      const message = detail(response, 'totalAmount') ?? '';
      expect(message).toContain('…');
      expect(message.length).toBeLessThan(150);
    });

    it('query parameters: gives the allowed range and the allowed names', async () => {
      const { app } = buildTestApp();
      const badLimit = await request(app).get(ORDERS).query({ limit: '500' });
      const unknown = await request(app).get(ORDERS).query({ page: '2' });

      expect(detail(badLimit, 'limit')).toBe('must be an integer from 1 to 100');
      expect(detail(unknown, 'query')).toBe(
        'unknown field(s): page; allowed fields: limit, offset, orderType',
      );
    });
  });

  describe('authentication and access', () => {
    it.each([
      [undefined, 'API key is missing: send your key in the X-API-Key header'],
      ['wrong-key', 'API key is invalid: check the X-API-Key header value'],
    ])('key %p -> %s', async (key, message) => {
      const { app } = buildTestApp({ API_KEYS: `partner-a:${KEY}` });
      const req = request(app).get(ORDERS);
      const response = await (key === undefined ? req : req.set('X-API-Key', key));

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe(message);
    });

    it('unknown order id: names the id', async () => {
      const { app } = buildTestApp();
      const id = '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f';
      const response = await request(app).get(`${ORDERS}/${id}`);
      expect(response.body.error.message).toBe(`Order ${id} not found`);
    });

    it('wrong method: names the path and the allowed methods', async () => {
      const { app } = buildTestApp();
      const response = await request(app).delete(ORDERS);
      expect(response.body.error.message).toBe(
        'Method DELETE is not allowed on /api/v1/orders; allowed: GET, POST, HEAD, OPTIONS',
      );
    });
  });

  describe('limits and retries', () => {
    it('IP rate limit: states the limit and when to retry', async () => {
      const { app } = buildTestApp({ RATE_LIMIT_MAX: '1', RATE_LIMIT_WINDOW_MS: '60000' });
      await request(app).get(ORDERS);
      const response = await request(app).get(ORDERS);

      expect(response.body.error.message).toMatch(
        /^Too many requests from this IP address \(limit 1 per 1 min\); retry in \d+ s$/,
      );
    });

    it('partner quota: states the limit and when to retry', async () => {
      const { app } = buildTestApp({
        API_KEYS: `partner-a:${KEY}`,
        PARTNER_RATE_LIMIT_MAX: '1',
        RATE_LIMIT_WINDOW_MS: '30000',
      });
      await request(app).get(ORDERS).set('X-API-Key', KEY);
      const response = await request(app).get(ORDERS).set('X-API-Key', KEY);

      expect(response.body.error.message).toMatch(
        /^Partner request quota exceeded \(limit 1 per 30 s\); retry in \d+ s$/,
      );
    });

    it('idempotency key reused with another body: explains both options', async () => {
      const { app } = buildTestApp();
      await request(app).post(ORDERS).set('Idempotency-Key', 'k1').send(briefExampleRequest);
      const response = await request(app)
        .post(ORDERS)
        .set('Idempotency-Key', 'k1')
        .send({ ...briefExampleRequest, totalAmount: '5' });

      expect(response.body.error.message).toBe(
        'This Idempotency-Key was already used with a different request body; use a new key for a new request, or resend the original body to get the original response',
      );
    });
  });
});
