/** The application records a declared net amount and separately declared tax.
 * This version identifies that amount convention, never a statutory tax rate. */
export const DECLARED_INVESTMENT_INCOME_POLICY = "declared_net_plus_withholding_v1";
export const INVESTMENT_INCOME_CURRENCY_POLICY = "source_bound_currency_v1";
// Server-derived conversion: household rate valid on the event date, else the provider rate on or before it.
export const DATED_INVESTMENT_FX_POLICY = "dated_household_then_provider_fx_v1";
export function isInvestmentIncome(type: string) {
  return type === "interest" || type === "dividend" || type === "coupon";
}
