import { useFormatters } from "@/contexts/SettingsContext";
import { getCurrencySymbol } from "@/lib/format";
import { isCurrencyCode } from "@shared/denomination";
import { isParsableMoneyString } from "@/lib/money";
import type { MoneyDto } from "@shared/money";

function moneyCurrency(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const { amount, currency } = value as Partial<MoneyDto>;
  return typeof amount === "string" && isParsableMoneyString(amount) && isCurrencyCode(currency) ? currency : null;
}

/** A combined amount has a denomination only if every input carries that unit. */
export function commonBudgetCurrency(amounts: readonly unknown[]): string | null {
  const currencies = new Set(amounts.map(moneyCurrency));
  return currencies.size === 1 ? [...currencies][0] : null;
}

export function useBudgetMoneyDisplay(currency: string | null | undefined) {
  const { formatCurrency } = useFormatters();
  const formatAmount = (amount: number) => currency === null ? "Unavailable" : formatCurrency(amount, currency);
  return {
    formatCurrency: formatAmount,
    formatLimit: (limit: number | null, hasWithheldLimit?: boolean) => {
      if (limit === null) return hasWithheldLimit ? "Unavailable" : "Unbudgeted";
      const amount = formatAmount(limit);
      return hasWithheldLimit && currency !== null ? `At least ${amount}` : amount;
    },
    // Undefined supports older caller model shapes. Live progress passes the
    // DTO unit, or null when it cannot establish the unit.
    prefix: currency === null ? "" : currency ? getCurrencySymbol(currency) : formatCurrency(0).replace(/[0-9.,-]/g, ""),
  };
}
