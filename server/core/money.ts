import Decimal from "decimal.js";
import type { MoneyDto } from "@shared/money";
import { logger } from "../utils/logger";

export type MoneyInput = Decimal | number | string;

/**
 * Money class for handling monetary values with correct precision.
 * Wraps decimal.js to prevent floating point errors.
 * Standardizes on 2 decimal places for storage and display, but maintains higher precision for intermediate calculations.
 *
 * IMPORTANT: When performing arithmetic operations between Money instances,
 * currencies should match. Mismatched currencies will log a warning.
 */
export class Money {
  private readonly _amount: Decimal;
  private readonly _currency: string;

  constructor(amount: MoneyInput, currency: string = "ZMW") {
    // We use Decimal for internal storage to avoid floating point issues
    this._amount = new Decimal(amount);
    this._currency = currency;
  }

  /**
   * Create a Money instance from various input types
   */
  static from(amount: Money | MoneyInput, currency: string = "ZMW"): Money {
    if (amount instanceof Money) {
      return new Money(amount._amount, amount._currency);
    }
    return new Money(amount, currency);
  }

  /**
   * Create a zero value Money instance
   */
  static zero(currency: string = "ZMW"): Money {
    return new Money(0, currency);
  }

  // Basic Arithmetic

  add(other: Money | MoneyInput): Money {
    if (other instanceof Money && other._currency !== this._currency) {
      logger.warn("Money currency mismatch in add operation", {
        thisCurrency: this._currency,
        otherCurrency: other._currency,
        thisAmount: this.toString(),
        otherAmount: other.toString(),
      });
    }
    const otherAmount =
      other instanceof Money ? other._amount : new Decimal(other);
    return new Money(this._amount.plus(otherAmount), this._currency);
  }

  subtract(other: Money | MoneyInput): Money {
    if (other instanceof Money && other._currency !== this._currency) {
      logger.warn("Money currency mismatch in subtract operation", {
        thisCurrency: this._currency,
        otherCurrency: other._currency,
        thisAmount: this.toString(),
        otherAmount: other.toString(),
      });
    }
    const otherAmount =
      other instanceof Money ? other._amount : new Decimal(other);
    return new Money(this._amount.minus(otherAmount), this._currency);
  }

  multiply(factor: MoneyInput): Money {
    return new Money(this._amount.times(factor), this._currency);
  }

  divide(divisor: MoneyInput): Money {
    return new Money(this._amount.div(divisor), this._currency);
  }

  abs(): Money {
    return new Money(this._amount.abs(), this._currency);
  }

  negated(): Money {
    return new Money(this._amount.negated(), this._currency);
  }

  // Comparisons

  equals(other: Money | MoneyInput): boolean {
    if (other instanceof Money && other._currency !== this._currency) {
      logger.warn("Money currency mismatch in equals comparison", {
        thisCurrency: this._currency,
        otherCurrency: other._currency,
      });
    }
    const otherAmount =
      other instanceof Money ? other._amount : new Decimal(other);
    return this._amount.equals(otherAmount);
  }

  gt(other: Money | MoneyInput): boolean {
    if (other instanceof Money && other._currency !== this._currency) {
      logger.warn("Money currency mismatch in gt comparison", {
        thisCurrency: this._currency,
        otherCurrency: other._currency,
      });
    }
    const otherAmount =
      other instanceof Money ? other._amount : new Decimal(other);
    return this._amount.greaterThan(otherAmount);
  }

  gte(other: Money | MoneyInput): boolean {
    if (other instanceof Money && other._currency !== this._currency) {
      logger.warn("Money currency mismatch in gte comparison", {
        thisCurrency: this._currency,
        otherCurrency: other._currency,
      });
    }
    const otherAmount =
      other instanceof Money ? other._amount : new Decimal(other);
    return this._amount.greaterThanOrEqualTo(otherAmount);
  }

  lt(other: Money | MoneyInput): boolean {
    if (other instanceof Money && other._currency !== this._currency) {
      logger.warn("Money currency mismatch in lt comparison", {
        thisCurrency: this._currency,
        otherCurrency: other._currency,
      });
    }
    const otherAmount =
      other instanceof Money ? other._amount : new Decimal(other);
    return this._amount.lessThan(otherAmount);
  }

  lte(other: Money | MoneyInput): boolean {
    if (other instanceof Money && other._currency !== this._currency) {
      logger.warn("Money currency mismatch in lte comparison", {
        thisCurrency: this._currency,
        otherCurrency: other._currency,
      });
    }
    const otherAmount =
      other instanceof Money ? other._amount : new Decimal(other);
    return this._amount.lessThanOrEqualTo(otherAmount);
  }

  isZero(): boolean {
    return this._amount.isZero();
  }

  // Strictly above zero. decimal.js isPositive() is true for +0, which made a
  // zero amount "positive" (NEW-23); isPositiveOrZero() is the >= 0 test.
  isPositive(): boolean {
    return this._amount.greaterThan(0);
  }

  isNegative(): boolean {
    return this._amount.isNegative();
  }

  isNegativeOrZero(): boolean {
    return this._amount.isNegative() || this._amount.isZero();
  }

  isPositiveOrZero(): boolean {
    return this._amount.isPositive() || this._amount.isZero();
  }

  // Conversion & Output

  /**
   * Returns the amount as a simple number.
   * WARNING: Use with caution as this can introduce floating point errors.
   * Prefer toString() for storage/transport.
   */
  toNumber(): number {
    return this._amount.toNumber();
  }

  /**
   * Returns the amount as a string fixed to 2 decimal places.
   * Ideal for database storage and API responses.
   */
  toString(): string {
    return this._amount.toFixed(2);
  }

  /**
   * Returns the full precision string.
   */
  toFullString(): string {
    return this._amount.toString();
  }

  /**
   * JSON serialization
   */
  toJSON(): string {
    return this.toString();
  }

  /**
   * Formats the money value for display.
   * e.g., "K 1,234.56"
   */
  format(locale: string = "en-ZM"): string {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: this._currency,
    }).format(this.toNumber());
  }

  get amount(): Decimal {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }
}

export const roundMoney = (
  amount: MoneyInput,
  decimals: number = 2,
): string => {
  return new Decimal(amount)
    .toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
    .toFixed(decimals);
};

export const formatMoney = (
  amount: Money | MoneyInput,
  currency: string = "ZMW",
  locale: string = "en-ZM",
): string => {
  const money = Money.from(amount, currency);
  return money.format(locale);
};

export const toMoneyDto = (
  amount: Money | MoneyInput,
  currency: string = "ZMW",
): MoneyDto => {
  const money = Money.from(amount, currency);
  return {
    amount: roundMoney(money.amount, 2),
    currency: money.currency,
  };
};

/** A stored amount whose unit may be unknown; the DTO then says so rather than assuming ZMW. */
export type AmountInUnitDto = { amount: string; currency: string | null };

/** MoneyDto in the given unit, or the stored amount with an explicit unknown unit (FIN-05). */
export function amountInUnit(amount: string | number, currency: string | null | undefined): AmountInUnitDto {
  return currency ? toMoneyDto(amount, currency) : { amount: String(amount), currency: null };
}
