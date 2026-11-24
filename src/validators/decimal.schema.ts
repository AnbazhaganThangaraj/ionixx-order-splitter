import { z } from 'zod';
import { quote } from '../errors/app-error';
import { Decimal } from '../lib/decimal';

/** Plain non-negative decimal: digits, optional fraction. No signs, exponents, commas or spaces. */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

interface DecimalFieldOptions {
  /** Maximum number of digits allowed after the decimal point. */
  readonly maxDecimals: number;
  /** Inclusive upper bound. */
  readonly max: string;
}

/**
 * Accepts a decimal as a JSON string ("100.50", preferred) or a JSON number (100.5)
 * and converts it to a Decimal immediately, so floats are never used for arithmetic.
 * The value must be strictly greater than zero.
 */
export const positiveDecimal = ({
  maxDecimals,
  max,
}: DecimalFieldOptions): z.ZodPipe<z.ZodUnknown, z.ZodTransform<Decimal>> =>
  z.unknown().transform((value, ctx): Decimal => {
    if (value === undefined || value === null) {
      ctx.addIssue({ code: 'custom', message: 'is required (a decimal string such as "100.50")' });
      return z.NEVER;
    }

    let text: string;
    if (typeof value === 'string') {
      text = value.trim();
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      text = String(value);
    } else {
      ctx.addIssue({
        code: 'custom',
        message: `must be a decimal string such as "100.50" (got ${
          typeof value === 'number'
            ? 'a non-finite number'
            : Array.isArray(value)
              ? 'an array'
              : typeof value
        })`,
      });
      return z.NEVER;
    }

    if (!DECIMAL_PATTERN.test(text)) {
      ctx.addIssue({
        code: 'custom',
        message: `must be a positive decimal number such as "100.50" (got ${quote(text, 20)}; no signs, exponents, commas or spaces)`,
      });
      return z.NEVER;
    }

    const decimal = new Decimal(text);
    if (decimal.lte(0)) {
      ctx.addIssue({ code: 'custom', message: 'must be greater than 0' });
      return z.NEVER;
    }
    if (decimal.decimalPlaces() > maxDecimals) {
      ctx.addIssue({
        code: 'custom',
        message: `must have at most ${maxDecimals} decimal places (got ${decimal.decimalPlaces()})`,
      });
      return z.NEVER;
    }
    if (decimal.gt(max)) {
      ctx.addIssue({ code: 'custom', message: `must not exceed ${max}` });
      return z.NEVER;
    }
    return decimal;
  });
