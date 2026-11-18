export interface TransactionFilters {
  categoryIds: string[];
  merchantIds: string[];
  accountIds: string[];
  tagIds: string[];
  goalIds: string[];
  amountMin: number | undefined;
  amountMax: number | undefined;
  types: Array<"income" | "expense" | "transfer">;
  statuses: Array<"pending" | "cleared" | "reconciled">;
  isReviewed: boolean | undefined;
  isExcludedFromReports: boolean | undefined;
  isExcludedFromBudget: boolean | undefined;
  isPrivate: boolean | undefined;
}

export const defaultFilters: TransactionFilters = {
  categoryIds: [],
  merchantIds: [],
  accountIds: [],
  tagIds: [],
  goalIds: [],
  amountMin: undefined,
  amountMax: undefined,
  types: [],
  statuses: [],
  isReviewed: undefined,
  isExcludedFromReports: undefined,
  isExcludedFromBudget: undefined,
  isPrivate: undefined,
};

export type FilterSection =
  | "categories"
  | "merchants"
  | "accounts"
  | "tags"
  | "goals"
  | "amount"
  | "other";

export interface FilterItem {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  imageUrl?: string | null;
  initials?: string;
  category?: string | null;
}
