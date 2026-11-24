import { ConfigError, hashApiKey, loadConfig } from '../../../src/config/app.config';

describe('loadConfig', () => {
  it('applies safe defaults when nothing is set', () => {
    const config = loadConfig({});

    expect(config.port).toBe(3000);
    expect(config.order).toEqual({
      defaultStockPrice: '100',
      quantityPrecision: 3,
      moneyPrecision: 2,
    });
    expect(config.market).toEqual({
      timeZone: 'America/New_York',
      openTime: '09:30',
      closeTime: '16:00',
    });
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      PORT: '8080',
      QUANTITY_PRECISION: '7',
      DEFAULT_STOCK_PRICE: '250.50',
      MARKET_TIMEZONE: 'Europe/London',
      MARKET_OPEN_TIME: '08:00',
      MARKET_CLOSE_TIME: '16:30',
    });

    expect(config.port).toBe(8080);
    expect(config.order.quantityPrecision).toBe(7);
    expect(config.order.defaultStockPrice).toBe('250.50');
    expect(config.market).toEqual({
      timeZone: 'Europe/London',
      openTime: '08:00',
      closeTime: '16:30',
    });
  });

  it('reads the number of trusted proxies', () => {
    expect(loadConfig({}).http.trustProxyHops).toBe(0);
    expect(loadConfig({ TRUST_PROXY: '2' }).http.trustProxyHops).toBe(2);
  });

  describe('API_KEYS', () => {
    const key = (prefix: string) => `${prefix}-0123456789abcdefghijklmn`;

    it('is empty (auth disabled) by default outside production', () => {
      expect(loadConfig({}).auth.apiKeys).toEqual([]);
    });

    it('parses partner:key pairs, keeping only SHA-256 hashes of the keys', () => {
      const config = loadConfig({
        API_KEYS: ` alpha:${key('a1')}, alpha:${key('a2')} ,beta_2:${key('b')} `,
      });
      expect(config.auth.apiKeys).toEqual([
        { partnerId: 'alpha', keyHash: hashApiKey(key('a1')) },
        { partnerId: 'alpha', keyHash: hashApiKey(key('a2')) },
        { partnerId: 'beta_2', keyHash: hashApiKey(key('b')) },
      ]);
      expect(JSON.stringify(config)).not.toContain(key('a1'));
      expect(config.auth.plaintextKeysConfigured).toBe(true);
    });

    it('accepts pre-hashed keys via API_KEY_HASHES (the production format)', () => {
      const hash = hashApiKey(key('h'));
      const config = loadConfig({ API_KEY_HASHES: `gamma:${hash.toUpperCase()}` });
      expect(config.auth.apiKeys).toEqual([{ partnerId: 'gamma', keyHash: hash }]);
      expect(config.auth.plaintextKeysConfigured).toBe(false);
    });

    it.each(['gamma:abc', `gamma:${'z'.repeat(64)}`, 'abc'])(
      'rejects an invalid hash entry %p',
      (value) => {
        expect(() => loadConfig({ API_KEY_HASHES: value })).toThrow(/API_KEY_HASHES/);
      },
    );

    it('rejects the same key configured twice, across both variables', () => {
      expect(() =>
        loadConfig({ API_KEYS: `a:${key('x')}`, API_KEY_HASHES: `b:${hashApiKey(key('x'))}` }),
      ).toThrow(/more than once/);
    });

    it('matches the documented hash of a known key', () => {
      expect(hashApiKey('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it.each([
      ['no separator', 'justakeywithoutpartner0123456789'],
      ['empty partner', `:${'k'.repeat(30)}`],
      ['short key', 'alpha:tooshort'],
      ['bad partner id', `al pha:${'k'.repeat(30)}`],
      ['duplicate key', `a:${'k'.repeat(30)},b:${'k'.repeat(30)}`],
    ])('rejects %s', (_label, value) => {
      expect(() => loadConfig({ API_KEYS: value })).toThrow(ConfigError);
    });

    it('never includes the key itself in error messages', () => {
      try {
        loadConfig({ API_KEYS: 'alpha:secret-but-short' });
      } catch (error) {
        expect((error as ConfigError).message).not.toContain('secret-but-short');
        return;
      }
      throw new Error('expected ConfigError');
    });

    it('is required in production', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
        /is required when NODE_ENV=production/,
      );
      expect(
        loadConfig({ NODE_ENV: 'production', API_KEY_HASHES: `alpha:${hashApiKey(key('a'))}` }).auth
          .apiKeys,
      ).toHaveLength(1);
      expect(
        loadConfig({ NODE_ENV: 'production', API_KEYS: `alpha:${key('a')}` }).auth.apiKeys,
      ).toHaveLength(1);
    });
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ QUANTITY_PRECISION: '' }).order.quantityPrecision).toBe(3);
  });

  it.each([
    ['QUANTITY_PRECISION', '-1'],
    ['QUANTITY_PRECISION', '11'],
    ['QUANTITY_PRECISION', '2.5'],
    ['QUANTITY_PRECISION', 'abc'],
    ['DEFAULT_STOCK_PRICE', '0'],
    ['DEFAULT_STOCK_PRICE', '-100'],
    ['DEFAULT_STOCK_PRICE', 'abc'],
    ['PORT', '70000'],
    ['MARKET_TIMEZONE', 'Mars/Olympus'],
    ['MARKET_OPEN_TIME', '9:30'],
    ['MARKET_CLOSE_TIME', '25:00'],
    ['TRUST_PROXY', '-1'],
    ['TRUST_PROXY', 'yes'],
    ['RATE_LIMIT_MAX', '0'],
    ['PARTNER_RATE_LIMIT_MAX', '0'],
    ['RATE_LIMIT_WINDOW_MS', '10'],
    ['IDEMPOTENCY_TTL_SECONDS', '5'],
  ])('fails fast when %s=%s', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(ConfigError);
  });

  it('rejects a market open time that is not before close time', () => {
    expect(() => loadConfig({ MARKET_OPEN_TIME: '16:00', MARKET_CLOSE_TIME: '09:30' })).toThrow(
      /MARKET_OPEN_TIME must be earlier/,
    );
  });

  it('reports every invalid setting at once', () => {
    try {
      loadConfig({ QUANTITY_PRECISION: '-1', DEFAULT_STOCK_PRICE: '0' });
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toHaveLength(2);
    }
  });
});
