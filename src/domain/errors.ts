/**
 * Business-rule failures, free of HTTP concerns. The HTTP layer decides how each
 * one is presented (src/errors/domain-error.mapper.ts).
 */
export abstract class DomainError extends Error {}

export class OrderNotFoundError extends DomainError {
  constructor(public readonly orderId: string) {
    super(`Order ${orderId} not found`);
    this.name = 'OrderNotFoundError';
  }
}

/** The order would not trade anything: every line rounds down to zero shares. */
export class OrderNotExecutableError extends DomainError {
  constructor(
    public readonly quantityPrecision: number,
    public readonly lineProblems: readonly { readonly index: number; readonly message: string }[],
  ) {
    super(
      'Order would not trade anything: no stock receives enough of totalAmount to buy the ' +
        `smallest allowed quantity (${quantityPrecision} decimal places). Increase totalAmount.`,
    );
    this.name = 'OrderNotExecutableError';
  }
}
