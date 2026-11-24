/**
 * Per-request values that middleware stores on res.locals: the request id (set by
 * requestId), the partner id (set by apiKeyAuth) and the router mount path (set by
 * recordMountPath). Kept here so controllers and middleware share them without
 * depending on each other.
 */
type Locals = Record<string, unknown>;

export const getRequestId = (locals: Locals): string =>
  typeof locals.requestId === 'string' ? locals.requestId : 'unknown';

export const getPartnerId = (locals: Locals): string => {
  if (typeof locals.partnerId !== 'string') {
    // Programming error: route mounted without apiKeyAuth.
    throw new Error('partnerId missing: apiKeyAuth middleware not applied');
  }
  return locals.partnerId;
};

export const findPartnerId = (locals: Locals): string | undefined =>
  typeof locals.partnerId === 'string' ? locals.partnerId : undefined;
