import { createHash } from 'node:crypto';

/** SHA-256 digest of a UTF-8 string. */
export const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

export const sha256Hex = (value: string): string => sha256(value).toString('hex');

/**
 * Hash stored for an API key. SHA-256 (not bcrypt) is appropriate because keys are
 * long random values, not human passwords, so they cannot be brute-forced from the hash.
 */
export const hashApiKey = (key: string): string => sha256Hex(key);
