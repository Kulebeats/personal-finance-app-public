import { Account } from "@/lib/api";

export type AccountTypeGroup =
  | "Banks"
  | "Credit Cards"
  | "Cash"
  | "Mobile Money"
  | "Investments"
  | "Loans"
  | "Real Estate"
  | "Vehicles"
  | "Other";

export interface AccountGroupData {
  title: string;
  accounts: Account[];
  total: number;
  isLiability: boolean;
}

export interface NetWorthPoint {
  date: string;
  value: number;
  assets: number;
  liabilities: number;
  currency?: string;
  provenance?: "captured_snapshot";
}

export interface AccountsSummaryData {
  totalAssets: number;
  totalLiabilities: number;
  netWorthValue: number;
  available?: boolean;
  currency?: string;
  status?: "checking" | "error" | "available" | "unavailable";
}

export type AccountHistoryState = "checking" | "error" | "ready";

export interface AccountFilterState {
  dateRange: string;
  ownerUserId: string | null | "all";
}
