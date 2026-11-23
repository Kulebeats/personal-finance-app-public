/**
 * Recurring totals by unit (FIN-05).
 *
 * A rule's amount is labelled with its proven currency, or `null` when the
 * server cannot prove it. A total adds only amounts in one currency; every
 * other amount is counted as excluded so the UI can say the total is partial.
 */
import type { MoneyDto } from "@shared/money";
import { formatAmount, sumMoneyDto, toMoneyNumber, zeroMoneyDto } from "@/lib/money";

/** Formats an amount in its own unit; an unknown unit shows the bare number. */
export function formatInOwnUnit(dto: MoneyDto, format: (value: number, currency: string) => string): string {
  return dto.currency ? format(toMoneyNumber(dto), dto.currency) : formatAmount(dto);
}

export interface CurrencyTotal {
  total: MoneyDto;
  excludedCount: number;
}

export function sumInCurrency(amounts: readonly MoneyDto[], currency: string): CurrencyTotal {
  const included = amounts.filter((amount) => amount.currency === currency);
  return {
    total: included.length ? sumMoneyDto(included, currency) : zeroMoneyDto(currency),
    excludedCount: amounts.length - included.length,
  };
}
