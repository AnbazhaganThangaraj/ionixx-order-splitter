import { z } from 'zod';
import { quote } from '../errors/app-error';

/**
 * Small building blocks shared by the request validators and the configuration
 * schema, so the same rule is written once.
 */

/** Describes a received value for an error message without echoing large inputs. */
export const describeValue = (input: unknown): string => {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'an array';
  if (typeof input === 'string') return quote(input, 20);
  if (typeof input === 'number' && !Number.isFinite(input)) return 'a non-finite number';
  return typeof input === 'object' ? 'an object' : typeof input;
};

export type DigitsIntegerSchema = z.ZodPipe<
  z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>,
  z.ZodNumber
>;

/**
 * An integer written as plain digits, within [min, max]. Rejects forms that Number()
 * would accept ("1e3", "0x10", "2.5", " 5"). Used for query strings and env settings,
 * which always arrive as strings.
 */
export const digitsInteger = (min: number, max: number, message: string): DigitsIntegerSchema =>
  z
    .string({ error: message })
    .regex(/^\d+$/, message)
    .transform(Number)
    .pipe(z.number().min(min, message).max(max, message));
