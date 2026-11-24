import type { OrderLine, OrderTotals } from '../domain/order.types';
import { Decimal } from '../lib/decimal';
import type { CreateOrderCommand } from '../domain/order.commands';
import { splitAmount } from './amount-splitter';
import { resolvePrice } from './price-resolver';
import { calculateQuantity } from './quantity-calculator';

export interface OrderCalculatorOptions {
  readonly defaultStockPrice: string;
  readonly quantityPrecision: number;
  readonly moneyPrecision: number;
}

export interface OrderCalculation {
  /** totalAmount formatted to money precision. */
  readonly totalAmount: string;
  /** Precision the quantities were calculated at (recorded on the order). */
  readonly quantityPrecision: number;
  readonly lines: OrderLine[];
  readonly totals: OrderTotals;
  readonly warnings: string[];
  /** Lines whose quantity rounded down to zero, with the reason (also in warnings). */
  readonly untradableLines: { readonly index: number; readonly message: string }[];
}

export type CalculationInput = Pick<CreateOrderCommand, 'totalAmount' | 'portfolio'>;

/** Port used by the order service; OrderCalculator is the implementation. */
export interface PortfolioCalculator {
  calculate(input: CalculationInput): OrderCalculation;
}

/**
 * Pure calculation: portfolio + amount -> per-stock amount, price and quantity.
 * No I/O, no clock, no IDs, so it is trivial to unit test.
 *
 * BUY and SELL use the same maths: the amount is a VALUE to buy or sell, split by
 * portfolio weight. Holdings are not part of the input, so SELL quantities are not
 * checked against what the user owns (documented assumption).
 */
export class OrderCalculator implements PortfolioCalculator {
  private readonly defaultPrice: Decimal;

  constructor(private readonly options: OrderCalculatorOptions) {
    this.defaultPrice = new Decimal(options.defaultStockPrice);
  }

  calculate({ totalAmount, portfolio }: CalculationInput): OrderCalculation {
    const { quantityPrecision, moneyPrecision } = this.options;
    const amounts = splitAmount(
      totalAmount,
      portfolio.map((item) => item.allocation),
      moneyPrecision,
    );

    const untradableLines: { index: number; message: string }[] = [];
    let totalValue = new Decimal(0);
    let totalResidual = new Decimal(0);

    const lines = portfolio.map((item, index): OrderLine => {
      const allocatedAmount = amounts[index] ?? new Decimal(0);
      const { price, source } = resolvePrice(item.marketPrice, this.defaultPrice);
      const { quantity, estimatedValue, residualAmount } = calculateQuantity(
        allocatedAmount,
        price,
        quantityPrecision,
        moneyPrecision,
      );

      totalValue = totalValue.plus(estimatedValue);
      totalResidual = totalResidual.plus(residualAmount);

      if (quantity.isZero()) {
        untradableLines.push({
          index,
          message:
            `${item.symbol}: allocated amount ${this.money(allocatedAmount)} is too small to trade any ` +
            `shares at ${this.price(price)} with ${quantityPrecision} decimal places; ` +
            'the full amount is reported as residual cash',
        });
      }

      return {
        symbol: item.symbol,
        allocationPercent: item.allocation.toString(),
        allocatedAmount: this.money(allocatedAmount),
        price: this.price(price),
        priceSource: source,
        quantity: quantity.toFixed(quantityPrecision),
        estimatedValue: this.money(estimatedValue),
        residualAmount: this.money(residualAmount),
      };
    });

    return {
      totalAmount: this.money(totalAmount),
      quantityPrecision,
      lines,
      totals: {
        allocatedAmount: this.money(totalAmount),
        estimatedValue: this.money(totalValue),
        residualAmount: this.money(totalResidual),
      },
      warnings: untradableLines.map((line) => line.message),
      untradableLines,
    };
  }

  private money(value: Decimal): string {
    return value.toFixed(this.options.moneyPrecision);
  }

  /** Prices keep their own precision (e.g. 0.1234) but show at least cents. */
  private price(value: Decimal): string {
    return value.toFixed(Math.max(this.options.moneyPrecision, value.decimalPlaces()));
  }
}
