import type { z } from 'zod';
import { ValidationError } from '../errors/app-error';

const formatPath = (path: readonly PropertyKey[]): string =>
  path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`;
    const name = String(key);
    return acc ? `${acc}.${name}` : name;
  }, '');

/**
 * Validates untrusted input at the HTTP boundary. Returns the typed, transformed
 * value or throws a ValidationError listing every problem (not just the first).
 */
export const parseOrThrow = <Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  rootName = 'body',
): z.output<Schema> => {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  throw new ValidationError(
    result.error.issues.map((issue) => {
      const path = formatPath(issue.path);
      if (issue.code === 'unrecognized_keys') {
        return {
          path: path || rootName,
          message: `unknown field(s): ${issue.keys.join(', ')}`,
        };
      }
      return { path: path || rootName, message: issue.message };
    }),
  );
};
