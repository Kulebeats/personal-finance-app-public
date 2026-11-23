/** This scope is constant: omitted private/legacy rows must not change metadata. */
export const ACCOUNT_WEALTH_SCOPE = "visible_account_linked" as const;
export interface AccountWealthSummary {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  currency: string;
  scope: typeof ACCOUNT_WEALTH_SCOPE;
  complete: false;
  valuationDate: string;
  fxPolicy: "trusted_same_day_only";
}
