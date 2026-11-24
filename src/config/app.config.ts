import { z } from 'zod';

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const POSITIVE_DECIMAL = /^(?!0+(\.0+)?$)\d+(\.\d+)?$/;

const isValidTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const PARTNER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MIN_API_KEY_LENGTH = 24;

export interface ApiKeyEntry {
  readonly partnerId: string;
  readonly key: string;
}

/**
 * API_KEYS format: "partnerId:key,partnerId:key". Each partner can hold several keys
 * (useful for rotation). Keys must be long random strings and unique.
 */
const parseApiKeys = (value: string, ctx: z.RefinementCtx): ApiKeyEntry[] => {
  const entries: ApiKeyEntry[] = [];
  const seenKeys = new Set<string>();
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .forEach((part, index) => {
      const separator = part.indexOf(':');
      const partnerId = separator > 0 ? part.slice(0, separator) : '';
      const key = separator > 0 ? part.slice(separator + 1) : '';
      // Never echo the key itself in error messages.
      if (!PARTNER_ID.test(partnerId)) {
        ctx.addIssue({
          code: 'custom',
          message: `entry ${index + 1} must look like "partnerId:key"`,
        });
      } else if (key.length < MIN_API_KEY_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          message: `key for "${partnerId}" must be at least ${MIN_API_KEY_LENGTH} characters`,
        });
      } else if (seenKeys.has(key)) {
        ctx.addIssue({ code: 'custom', message: `key for "${partnerId}" is used more than once` });
      } else {
        seenKeys.add(key);
        entries.push({ partnerId, key });
      }
    });
  return entries;
};

const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

/**
 * Environment schema. Every setting has a safe default so the app runs from a
 * clean clone, but any value that IS supplied must be valid — otherwise the
 * process refuses to start (fail fast) instead of calculating with bad config.
 */
const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DEFAULT_STOCK_PRICE: z
      .string()
      .regex(POSITIVE_DECIMAL, 'must be a positive decimal number, e.g. "100" or "100.00"')
      .default('100'),
    QUANTITY_PRECISION: z.coerce.number().int().min(0).max(10).default(3),
    MARKET_TIMEZONE: z
      .string()
      .refine(isValidTimeZone, 'must be a valid IANA time zone, e.g. "America/New_York"')
      .default('America/New_York'),
    MARKET_OPEN_TIME: z.string().regex(TIME_OF_DAY, 'must be HH:mm (24h)').default('09:30'),
    MARKET_CLOSE_TIME: z.string().regex(TIME_OF_DAY, 'must be HH:mm (24h)').default('16:00'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    API_KEYS: z.string().transform(parseApiKeys).default([]),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(100),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(60).max(604_800).default(86_400),
  })
  .refine((env) => toMinutes(env.MARKET_OPEN_TIME) < toMinutes(env.MARKET_CLOSE_TIME), {
    message: 'MARKET_OPEN_TIME must be earlier than MARKET_CLOSE_TIME',
    path: ['MARKET_OPEN_TIME'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.API_KEYS.length > 0, {
    message: 'API_KEYS is required when NODE_ENV=production (authentication cannot be disabled)',
    path: ['API_KEYS'],
  });

export interface AppConfig {
  readonly port: number;
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly order: {
    /** Price used when the partner does not supply a market price (decimal string). */
    readonly defaultStockPrice: string;
    /** Max decimal places allowed for share quantities. */
    readonly quantityPrecision: number;
    /** Decimal places for monetary amounts (USD cents). Not configurable on purpose. */
    readonly moneyPrecision: number;
  };
  readonly market: {
    readonly timeZone: string;
    readonly openTime: string;
    readonly closeTime: string;
  };
  readonly idempotency: {
    /** How long a completed request can be replayed with the same Idempotency-Key. */
    readonly ttlSeconds: number;
  };
  readonly auth: {
    /** Empty = authentication disabled (only allowed outside production). */
    readonly apiKeys: readonly ApiKeyEntry[];
  };
  readonly http: {
    /** Number of reverse proxies / load balancers in front of the app (0 = none). */
    readonly trustProxyHops: number;
    /** Max API requests per client IP per window. */
    readonly rateLimit: { readonly windowMs: number; readonly max: number };
  };
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Treat empty strings as "not set" so `FOO=` in a .env falls back to the default. */
const withoutEmptyValues = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const result = envSchema.safeParse(withoutEmptyValues(env));
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }
  const parsed = result.data;
  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    order: {
      defaultStockPrice: parsed.DEFAULT_STOCK_PRICE,
      quantityPrecision: parsed.QUANTITY_PRECISION,
      moneyPrecision: 2,
    },
    market: {
      timeZone: parsed.MARKET_TIMEZONE,
      openTime: parsed.MARKET_OPEN_TIME,
      closeTime: parsed.MARKET_CLOSE_TIME,
    },
    idempotency: {
      ttlSeconds: parsed.IDEMPOTENCY_TTL_SECONDS,
    },
    auth: {
      apiKeys: parsed.API_KEYS,
    },
    http: {
      trustProxyHops: parsed.TRUST_PROXY,
      rateLimit: { windowMs: parsed.RATE_LIMIT_WINDOW_MS, max: parsed.RATE_LIMIT_MAX },
    },
  };
};
