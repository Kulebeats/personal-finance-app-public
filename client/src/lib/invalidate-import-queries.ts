import { captureOperationLifetime, type OperationLifetime } from "./operation-lifetime";
import type { QueryClient, QueryFilters } from "@tanstack/react-query";

// Some wizard readers use the API path as their query key.
const ledgerRoots = [
  "accounts", "transactions", "reports", "budgets", "categories", "tags", "merchants",
  "/api/accounts", "/api/transactions",
];
const importRoots = new Set(ledgerRoots);
const reconciliationRoots = new Set([...ledgerRoots, "goals", "dashboard"]);

export function invalidateImportQueries(client: QueryClient, operation: OperationLifetime | null) {
  return refreshLedgerQueries(client, operation, importRoots);
}

export function invalidateReconciliationQueries(client: QueryClient, operation: OperationLifetime | null) {
  return refreshLedgerQueries(client, operation, reconciliationRoots);
}

async function refreshLedgerQueries(client: QueryClient, operation: OperationLifetime | null, roots: Set<string>) {
  const filters: QueryFilters = {
    predicate: ({ queryKey: [root] }) => typeof root === "string" && roots.has(root),
  };
  const isCurrent = () => captureOperationLifetime() === operation && operation?.active !== false;
  if (!isCurrent()) return;
  // Invalidation alone can reuse a first GET that started before the ledger write committed.
  await client.cancelQueries(filters);
  if (isCurrent()) void client.invalidateQueries(filters);
}
