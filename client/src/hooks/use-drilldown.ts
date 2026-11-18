/**
 * useDrillDown - Hook for navigating to transaction drill-down views
 *
 * Provides a function to navigate to the Transactions tab with pre-applied filters.
 *
 * R8 note: the `from`/`to`/`categoryId`/`accountId`/`type` param names below
 * already match the Transactions page's URL filter contract
 * (`client/src/features/transactions/transactionFilterParams.ts`), so links
 * built here now land correctly filtered instead of being silently ignored
 * (audit v2 finding B1). `merchantId`/`categoryGroupId` have no equivalent in
 * `TransactionFilters` yet and are harmlessly ignored by the Transactions
 * page - see the contract module's docblock before wiring those up.
 */

import { useCallback } from "react";
import { useLocation } from "wouter";

export interface DrillDownFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  categoryGroupId?: string;
  merchantId?: string;
  accountId?: string;
  type?: "income" | "expense" | "transfer";
}

export function useDrillDown() {
  const [, setLocation] = useLocation();

  const drillDown = useCallback(
    (filters: DrillDownFilters) => {
      const params = new URLSearchParams();

      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.categoryId) params.set("categoryId", filters.categoryId);
      if (filters.categoryGroupId)
        params.set("categoryGroupId", filters.categoryGroupId);
      if (filters.merchantId) params.set("merchantId", filters.merchantId);
      if (filters.accountId) params.set("accountId", filters.accountId);
      if (filters.type) params.set("type", filters.type);

      // Navigate to transactions page with filters
      setLocation(`/transactions?${params.toString()}`);
    },
    [setLocation]
  );

  return { drillDown };
}

export default useDrillDown;
