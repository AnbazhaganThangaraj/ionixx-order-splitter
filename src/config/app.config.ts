import { z } from 'zod';
import { hashApiKey } from '../lib/crypto';
import { minutesSinceMidnight, parseTimeOfDay } from '../lib/time-of-day';

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
const SHA256_HEX = /^[a-f0-9]{64}$/;

export interface ApiKeyEntry {
  readonly partnerId: string;
  /** SHA-256 of the API key, hex. Plaintext keys are hashed at load and then discarded. */
  readonly keyHash: string;
}

/**
 * Parses "partnerId:value,partnerId:value". Each partner may hold several keys
 * (rotation). For API_KEYS the value is the key itself (development convenience);
 * for API_KEY_HASHES it is the SHA-256 hex digest, so the real key never sits in config.
 */
const parseKeyList =
  (kind: 'plaintext' | 'hash') =>
  (value: string, ctx: z.RefinementCtx): ApiKeyEntry[] => {
    const entries: ApiKeyEntry[] = [];
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .forEach((part, index) => {
        const separator = part.indexOf(':');
        const partnerId = separator > 0 ? part.slice(0, separator) : '';
        const secret = separator > 0 ? part.slice(separator + 1) : '';
        // Never echo the secret itself in error messages.
        if (!PARTNER_ID.test(partnerId)) {
          ctx.addIssue({
            code: 'custom',
            message: `entry ${index + 1} must look like "partnerId:${kind === 'hash' ? 'sha256hex' : 'key'}"`,
          });
        } else if (kind === 'plaintext' && secret.length < MIN_API_KEY_LENGTH) {
          ctx.addIssue({
            code: 'custom',
            message: `key for "${partnerId}" must be at least ${MIN_API_KEY_LENGTH} characters`,
          });
        } else if (kind === 'hash' && !SHA256_HEX.test(secret.toLowerCase())) {
          ctx.addIssue({
            code: 'custom',
            message: `hash for "${partnerId}" must be a 64-character SHA-256 hex digest`,
          });
        } else {
          entries.push({
            partnerId,
            keyHash: kind === 'hash' ? secret.toLowerCase() : hashApiKey(secret),
          });
        }
      });
    return entries;
  };

/** Whole numbers only: rejects "1e3", "0x10", "2.5" and other forms Number() would accept. */
type IntegerSchema = z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>, z.ZodNumber>;

const integerSetting = (min: number, max: number, fallback: number): z.ZodDefault<IntegerSchema> =>
  z
    .string()
    .regex(/^\d+$/, `must be a whole number from ${min} to ${max}`)
    .transform(Number)
    .pipe(
      z
        .number()
        .min(min, `must be a whole number from ${min} to ${max}`)
        .max(max, `must be a whole number from ${min} to ${max}`),
    )
    .default(fallback);

const timeOfDaySetting = (fallback: string): z.ZodDefault<z.ZodString> =>
  z
    .string()
    .refine((value) => parseTimeOfDay(value) !== undefined, 'must be HH:mm (24h)')
    .default(fallback);

const minutesOf = (time: string): number => {
  const parsed = parseTimeOfDay(time);
  return parsed === undefined ? Number.NaN : minutesSinceMidnight(parsed);
};

/**
 * Environment schema. Every setting has a safe default so the app runs from a
 * clean clone, but any value that IS supplied must be valid — otherwise the
 * process refuses to start (fail fast) instead of calculating with bad config.
 */
const envSchema = z
  .object({
    // 0 = any free port (used by tests); the real port is logged at startup.
    PORT: integerSetting(0, 65535, 3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DEFAULT_STOCK_PRICE: z
      .string()
      .regex(POSITIVE_DECIMAL, 'must be a positive decimal number, e.g. "100" or "100.00"')
      .default('100'),
    QUANTITY_PRECISION: integerSetting(0, 10, 3),
    MARKET_TIMEZONE: z
      .string()
      .refine(isValidTimeZone, 'must be a valid IANA time zone, e.g. "America/New_York"')
      .default('America/New_York'),
    MARKET_OPEN_TIME: timeOfDaySetting('09:30'),
    MARKET_CLOSE_TIME: timeOfDaySetting('16:00'),
    TRUST_PROXY: integerSetting(0, 10, 0),
    API_KEYS: z.string().transform(parseKeyList('plaintext')).default([]),
    API_KEY_HASHES: z.string().transform(parseKeyList('hash')).default([]),
    AUTH_DISABLED: z
      .enum(['true', 'false'], { error: 'must be "true" or "false"' })
      .default('false')
      .transform((value) => value === 'true'),
    RATE_LIMIT_WINDOW_MS: integerSetting(1000, 3_600_000, 60_000),
    RATE_LIMIT_MAX: integerSetting(1, 100_000, 100),
    PARTNER_RATE_LIMIT_MAX: integerSetting(1, 1_000_000, 600),
    IDEMPOTENCY_TTL_SECONDS: integerSetting(60, 604_800, 86_400),
  })
  .refine((env) => minutesOf(env.MARKET_OPEN_TIME) < minutesOf(env.MARKET_CLOSE_TIME), {
    message: 'MARKET_OPEN_TIME must be earlier than MARKET_CLOSE_TIME',
    path: ['MARKET_OPEN_TIME'],
  })
  .superRefine((env, ctx) => {
    const all = [...env.API_KEYS, ...env.API_KEY_HASHES];
    const seen = new Map<string, string>();
    for (const entry of all) {
      const owner = seen.get(entry.keyHash);
      if (owner !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['API_KEYS'],
          message: `the same key is configured more than once ("${owner}" and "${entry.partnerId}")`,
        });
      }
      seen.set(entry.keyHash, entry.partnerId);
    }
    // Fail closed: running without authentication must be an explicit, local-only choice,
    // not the accidental result of forgetting to set NODE_ENV or the keys.
    if (env.AUTH_DISABLED) {
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_DISABLED'],
          message: 'AUTH_DISABLED=true is not allowed when NODE_ENV=production',
        });
      }
      if (all.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_DISABLED'],
          message: 'AUTH_DISABLED=true cannot be combined with API_KEYS or API_KEY_HASHES',
        });
      }
    } else if (all.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_KEYS'],
        message:
          env.NODE_ENV === 'production'
            ? 'API_KEY_HASHES (or API_KEYS) is required when NODE_ENV=production (authentication cannot be disabled)'
            : 'no API keys configured: set API_KEY_HASHES (or API_KEYS), or AUTH_DISABLED=true for local development only',
      });
    }
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
    /** True only when AUTH_DISABLED=true was set explicitly (never allowed in production). */
    readonly disabled: boolean;
    readonly apiKeys: readonly ApiKeyEntry[];
    /** True when plaintext keys were supplied via API_KEYS (fine locally, discouraged in production). */
    readonly plaintextKeysConfigured: boolean;
  };
  readonly http: {
    /** Number of reverse proxies / load balancers in front of the app (0 = none). */
    readonly trustProxyHops: number;
    /** Max API requests per client IP per window, and per authenticated partner per window. */
    readonly rateLimit: {
      readonly windowMs: number;
      readonly max: number;
      readonly partnerMax: number;
    };
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
      disabled: parsed.AUTH_DISABLED,
      apiKeys: [...parsed.API_KEYS, ...parsed.API_KEY_HASHES],
      plaintextKeysConfigured: parsed.API_KEYS.length > 0,
    },
    http: {
      trustProxyHops: parsed.TRUST_PROXY,
      rateLimit: {
        windowMs: parsed.RATE_LIMIT_WINDOW_MS,
        max: parsed.RATE_LIMIT_MAX,
        partnerMax: parsed.PARTNER_RATE_LIMIT_MAX,
      },
    },
  };
};
