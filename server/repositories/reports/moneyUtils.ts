import Decimal from "decimal.js";
import type { MoneyDto } from "@shared/money";
import { Money, toMoneyDto } from "../../core/money";

export function moneyFromValue(
  value: string | number | null | undefined,
  currency: string
): Money {
  try {
    return new Money(String(value ?? "0"), currency);
  } catch {
    return Money.zero(currency);
  }
}

export function moneyFromDto(
  value: MoneyDto | null | undefined,
  fallbackCurrency: string
): Money {
  if (!value) return Money.zero(fallbackCurrency);
  const currency = value.currency || fallbackCurrency;
  return moneyFromValue(value.amount, currency);
}

export function sumMoney(
  values: Money[],
  currency: string
): Money {
  return values.reduce(
    (sum, value) => sum.add(value),
    Money.zero(currency)
  );
}

export function sumMoneyDto(
  values: Array<MoneyDto | null | undefined>,
  currency: string
): Money {
  return values.reduce(
    (sum, value) => sum.add(moneyFromDto(value, currency)),
    Money.zero(currency)
  );
}

export function percentOf(
  part: Money,
  total: Money,
  decimals: number = 2
): number {
  if (total.amount.isZero()) return 0;
  return new Decimal(part.amount)
    .div(total.amount)
    .times(100)
    .toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function ratioOf(
  numerator: Money,
  denominator: Money,
  decimals: number = 2
): number {
  if (denominator.amount.isZero()) return 0;
  return new Decimal(numerator.amount)
    .div(denominator.amount)
    .toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function toMoneyDtoSafe(
  value: Money | Decimal | number | string,
  currency: string
): MoneyDto {
  return toMoneyDto(value, currency);
}
