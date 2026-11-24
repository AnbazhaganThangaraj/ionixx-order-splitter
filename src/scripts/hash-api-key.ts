import { randomBytes } from 'node:crypto';
import { hashApiKey } from '../config/app.config';

/**
 * Generates partner API keys and their SHA-256 hashes for API_KEY_HASHES.
 *
 *   npm run hash-key -- --generate partner-a   # new random key + config entry
 *   npm run hash-key -- <existing-key>         # hash an existing key
 *
 * Give the KEY to the partner over a secure channel; put only the HASH in config.
 * SHA-256 (rather than bcrypt) is appropriate because keys are 256-bit random values,
 * not human passwords, so they cannot be brute-forced from the hash.
 */
const [first, second] = process.argv.slice(2);

if (first === '--generate') {
  const partnerId = second ?? 'partner-id';
  const key = randomBytes(32).toString('base64url');
  console.log(`API key (give to ${partnerId}, shown once): ${key}`);
  console.log(`Config entry for API_KEY_HASHES:        ${partnerId}:${hashApiKey(key)}`);
} else if (first !== undefined && first.length > 0) {
  console.log(hashApiKey(first));
} else {
  console.error('Usage: npm run hash-key -- --generate <partnerId> | npm run hash-key -- <key>');
  process.exit(1);
}
