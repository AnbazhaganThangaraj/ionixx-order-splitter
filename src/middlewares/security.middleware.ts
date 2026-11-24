import type { RequestHandler } from 'express';
import helmet from 'helmet';

/**
 * Security headers for a JSON API. The API never serves HTML, so the Content
 * Security Policy can deny everything; HSTS tells clients to use HTTPS only.
 */
export const apiSecurityHeaders = (): RequestHandler =>
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

/** Swagger UI is an HTML page with its own scripts and inline styles, so it needs a looser policy. */
export const docsSecurityHeaders = (): RequestHandler =>
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  });

/** Order data is personal financial data: never let browsers or proxies cache it. */
export const noStore = (): RequestHandler => (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
