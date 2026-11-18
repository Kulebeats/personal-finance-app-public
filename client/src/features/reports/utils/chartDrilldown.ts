/**
 * Reports Chart Drill-Down Mapping
 *
 * Maps a clicked Reports chart segment (Cash Flow Sankey node, spending
 * breakdown pie slice) to the filters
 * `client/src/hooks/use-drilldown.ts#DrillDownFilters` needs to build a
 * correctly filtered `/transactions?...` link.
 *
 * `useDrillDown`'s param names (`categoryId`/`accountId`/`type`/`from`/`to`)
 * already match the R8 URL contract
 * (`client/src/features/transactions/transactionFilterParams.ts`), so this
 * module reuses it directly rather than re-deriving a query string.
 *
 * Replaces the non-functional Reports.tsx chart drill-downs (audit v2
 * finding B3: the Sankey panel showed a dead "Click to view transaction
 * details." placeholder; the spending pie chart had no drill-down wired at
 * all) with real mappings.
 */
import type { DrillDownFilters } from "@/hooks/use-drilldown";

/**
 * Sankey node fields relevant to drill-down. Matches the shape the server
 * attaches to every node in `ReportsSankeyResponse["sankey"]["nodes"]`.
 */
export interface SankeyDrilldownNode {
  entityType?: "categoryGroup" | "category" | "merchant" | "account" | "synthetic";
  entityId?: string;
}

export type SankeyDrilldownFilters = Pick<
  DrillDownFilters,
  "categoryId" | "accountId" | "type"
>;

/**
 * Map a clicked Sankey node to the transaction filters it represents, or
 * `null` when the node has no equivalent Transactions filter (a derived
 * total rather than a real, filterable entity).
 *
 * - `category` -> `categoryId` (a real category UUID).
 * - `account` -> `accountId` (`account_to_expense_groups` Sankey mode).
 * - `categoryGroup` -> `type: "expense"`. Category-group nodes in this
 *   Sankey are always expense-side aggregates, and there is no
 *   `categoryGroupId` filter in the R8 URL contract yet (see
 *   transactionFilterParams.ts's docblock) - narrowing by type is the
 *   closest honest filter available.
 * - `synthetic` "income" -> `type: "income"`. "savings"/"refunds" are
 *   derived totals, not a transaction type, so they return `null`.
 * - `merchant` -> `null`. Not produced by any current Sankey mode; no
 *   merchant filter exists in the R8 contract yet either.
 * - Any node whose `entityId` is a synthetic bucket (the "Uncategorized"
 *   category or group) -> `null`.
 */
export function sankeyNodeToDrillDownFilters(
  node: SankeyDrilldownNode,
): SankeyDrilldownFilters | null {
  if (isSyntheticBreakdownId(node.entityId)) return null;
  switch (node.entityType) {
    case "category":
      return node.entityId ? { categoryId: node.entityId } : null;
    case "account":
      return node.entityId ? { accountId: node.entityId } : null;
    case "categoryGroup":
      return { type: "expense" };
    case "synthetic":
      return node.entityId === "income" ? { type: "income" } : null;
    default:
      return null;
  }
}

/**
 * Ids of the server's synthetic "no entity" buckets (SpendingReportRepository
 * breakdown, SankeyLinks). They are not uuids and the transactions API has no
 * "missing category / merchant / tag" filter (transactionQuerySchema requires
 * a uuid), so these slices and nodes are not drillable.
 */
const SYNTHETIC_BREAKDOWN_IDS: ReadonlySet<string> = new Set([
  "uncategorized",
  "no-merchant",
  "untagged",
]);

export function isSyntheticBreakdownId(id: string | undefined): boolean {
  return id !== undefined && SYNTHETIC_BREAKDOWN_IDS.has(id);
}

/** How the Reports "Spending" pie chart is currently grouped (Reports.tsx `spendingGroupBy`). */
export type SpendingGroupBy = "categoryGroup" | "category" | "merchant";

/**
 * Map a clicked spending-breakdown pie slice to the transaction filters it
 * represents, or `null` when there is no equivalent Transactions filter.
 *
 * - `category` -> `categoryId` (the slice id is a real category UUID).
 * - `categoryGroup` -> `type: "expense"`. `getSpendingBreakdown` always
 *   queries `type: "expense"` for this report (see
 *   server/repositories/reports/SpendingReportRepository.ts), and there is
 *   no `categoryGroupId` filter in the R8 URL contract yet - narrowing by
 *   type is the closest honest filter available for a group-level slice.
 * - `merchant` -> `null`. No merchant filter exists in the R8 contract yet.
 * - A synthetic bucket (`uncategorized`, `no-merchant`, `untagged`) -> `null`.
 */
export function spendingItemToDrillDownFilters(
  groupBy: SpendingGroupBy,
  itemId: string,
): SankeyDrilldownFilters | null {
  if (isSyntheticBreakdownId(itemId)) return null;
  switch (groupBy) {
    case "category":
      return { categoryId: itemId };
    case "categoryGroup":
      return { type: "expense" };
    default:
      return null;
  }
}
