import type { Logger } from './logger';

/**
 * Security- and business-relevant events, logged separately from access logs so
 * they can be shipped to a SIEM, retained longer and alerted on
 * (e.g. a spike of auth.failed from one IP).
 */
export type AuditEvent =
  | 'auth.failed'
  | 'rate_limit.exceeded'
  | 'order.created'
  | 'idempotency.replayed'
  | 'idempotency.conflict';

export interface AuditLog {
  record(event: AuditEvent, details: Record<string, unknown>): void;
}

/** Audit events are pino log lines tagged { audit: true, event }. Never include secrets or order contents. */
export const createAuditLog = (logger: Logger): AuditLog => {
  const audit = logger.child({ audit: true });
  return {
    record: (event, details) => {
      audit.info({ event, ...details }, `audit: ${event}`);
    },
  };
};
