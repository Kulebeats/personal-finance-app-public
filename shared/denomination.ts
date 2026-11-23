/** Validate captured denomination without guessing a household preference. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

/** Query-free display formatting; unsupported inputs have no invented amount. */
export function formatDenominatedAmount(value: number, currency: unknown): string | null {
  if (!Number.isFinite(value) || !isCurrencyCode(currency)) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "code" }).format(value);
  } catch { return null; }
}
