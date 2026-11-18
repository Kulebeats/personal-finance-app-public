/**
 * CashFlowDrilldownPanel
 *
 * Shown under the Cash Flow Sankey diagram once a node is selected. Replaces
 * the former "Click to view transaction details." placeholder (audit v2
 * finding B3) with a real "View transactions" action that navigates to the
 * Transactions page filtered by the clicked node, via `useDrillDown`
 * (already R8-URL-contract-compatible - see
 * client/src/features/reports/utils/sankeyDrilldown.ts).
 *
 * Derived totals with no transaction-level equivalent (Savings, Refunds)
 * show an explicit "not drillable" message instead of a dead button.
 */
import { ShoppingBag, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDrillDown } from "@/hooks/use-drilldown";
import {
  sankeyNodeToDrillDownFilters,
  type SankeyDrilldownNode,
} from "../utils/chartDrilldown";

interface CashFlowDrilldownPanelProps {
  node: (SankeyDrilldownNode & { label?: string }) | null;
  dateRange: { from: string; to: string };
  onClear: () => void;
}

export function CashFlowDrilldownPanel({
  node,
  dateRange,
  onClear,
}: CashFlowDrilldownPanelProps) {
  const { drillDown } = useDrillDown();

  if (!node) return null;

  const filters = sankeyNodeToDrillDownFilters(node);
  const label = node.label ?? node.entityId ?? "Selection";

  return (
    <div className="mt-6 pt-6 border-t animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="font-bold text-lg">Transactions</h3>
        <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded text-sm font-medium">
          <ShoppingBag className="w-3 h-3" />
          {label}
          <button
            onClick={onClear}
            className="ml-1 hover:text-rose-500"
            aria-label="Clear selected category"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
      {filters ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => drillDown({ ...filters, ...dateRange })}
        >
          View transactions
          <ArrowRight className="w-3 h-3" />
        </Button>
      ) : (
        <p className="text-muted-foreground text-sm">
          This total is a summary and isn't linked to individual transactions.
        </p>
      )}
    </div>
  );
}
