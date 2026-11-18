/**
 * Transactions Feature Module - Types
 *
 * Shared type definitions for the transactions feature.
 *
 * @module features/transactions/types
 */

import type { Transaction as ApiTransaction } from "@/lib/api";

// Re-export base type
export type Transaction = ApiTransaction;

// Extended transaction with computed fields
export interface TransactionWithDetails extends Transaction {
  merchantName?: string;
  categoryName?: string;
  accountName?: string;
  tags?: string[];
}

// Filter state
export interface TransactionFilters {
  search: string;
  accountId: string | null;
  categoryId: string | null;
  tagIds: string[];
  startDate: Date | null;
  endDate: Date | null;
  amountMin: number | null;
  amountMax: number | null;
  type: "all" | "income" | "expense" | "transfer";
  reviewed: "all" | "reviewed" | "unreviewed";
  owner: "all" | "mine" | "shared";
}

export const defaultFilters: TransactionFilters = {
  search: "",
  accountId: null,
  categoryId: null,
  tagIds: [],
  startDate: null,
  endDate: null,
  amountMin: null,
  amountMax: null,
  type: "all",
  reviewed: "all",
  owner: "all",
};

// Sort options - must match server validation (transactions.validation.ts sortBy enum)
export type TransactionSortField = "date" | "amount" | "description"; // Server uses "description", not "name"/"category"/"account"
export type SortDirection = "asc" | "desc";

export interface TransactionSort {
  field: TransactionSortField;
  direction: SortDirection;
}

// Selection state
export interface TransactionSelection {
  selectedIds: Set<string>;
  isAllSelected: boolean;
}

// View mode
export type TransactionViewMode = "list" | "card" | "timeline";

// Action types for bulk operations
export type BulkAction =
  | "categorize"
  | "tag"
  | "review"
  | "hide"
  | "delete"
  | "split";

// Modal states
export interface TransactionModalState {
  view: TransactionWithDetails | null;
  edit: TransactionWithDetails | null;
  create: boolean;
  rule: { merchant: string; category: string } | null;
  recurring: TransactionWithDetails | null;
  split: TransactionWithDetails | null;
}
