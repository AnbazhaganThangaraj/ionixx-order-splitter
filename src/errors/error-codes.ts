/**
 * Every error code the API can return, in one place. Partners can branch on `code`;
 * `message` is for humans and may be reworded. The OpenAPI document and the contract
 * tests use this list, so an undocumented code cannot slip into a response.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_JSON',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'IDEMPOTENCY_KEY_REUSED',
  'RATE_LIMITED',
  'PARTNER_QUOTA_EXCEEDED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
