import { ConfigError, loadConfig } from '../../../src/config/app.config';

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
