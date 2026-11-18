import { AccountTypeGroup } from "./types";

export const ACCOUNT_TYPE_GROUPS: Record<string, AccountTypeGroup> = {
  checking: "Banks",
  savings: "Banks",
  credit: "Credit Cards",
  cash: "Cash",
  mobile_money: "Mobile Money",
  investment: "Investments",
  loan: "Loans",
  mortgage: "Loans",
  other_liability: "Loans",
  real_estate: "Real Estate",
  vehicle: "Vehicles",
};

export const ASSET_GROUPS: AccountTypeGroup[] = [
  "Banks",
  "Mobile Money",
  "Cash",
  "Investments",
  "Real Estate",
  "Vehicles",
];

export const LIABILITY_GROUPS: AccountTypeGroup[] = ["Credit Cards", "Loans"];
