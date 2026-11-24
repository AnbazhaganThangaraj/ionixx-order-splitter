import type { Response } from 'express';

export interface CapturedResponse {
  readonly statusCode: number;
  readonly body: unknown;
  readonly location: string | undefined;
  /** True when the response was fully sent with a 2xx status. */
  readonly succeeded: boolean;
}

/**
 * Calls `onSettled` exactly once when the response finishes or the connection closes,
 * with the status, the JSON body passed to res.json() and the Location header.
 */
export const onResponseSettled = (
  res: Response,
  onSettled: (response: CapturedResponse) => void,
): void => {
  let body: unknown;
  const originalJson = res.json.bind(res);
  res.json = (value: unknown) => {
    body = value;
    return originalJson(value);
  };

  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    const location = res.getHeader('Location');
    onSettled({
      statusCode: res.statusCode,
      body,
      location: typeof location === 'string' ? location : undefined,
      succeeded: res.writableFinished && res.statusCode >= 200 && res.statusCode < 300,
    });
  };
  res.on('finish', settle);
  res.on('close', settle);
};
