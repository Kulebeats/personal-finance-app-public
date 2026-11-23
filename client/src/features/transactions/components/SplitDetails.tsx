/**
 * SplitDetails Component
 *
 * Shared component for displaying transaction split details consistently
 * across all views (list, detail modal, receipts, etc.)
 */

import { Split, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/money";
import type { MoneyDto } from "@/lib/api";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface SplitItem {
  id?: string;
  amount: MoneyDto | { amount: string; currency: null } | string;
  categoryId?: string | null;
  categoryName?: string;
  notes?: string | null;
}

function formatSplitAmount(amount: SplitItem["amount"]) {
  if (typeof amount === "string") return formatCurrency(amount);
  if (!amount.currency) return `${amount.amount} (currency unknown)`;
  return formatCurrency({ amount: amount.amount, currency: amount.currency });
}

export interface SplitDetailsProps {
  splits: SplitItem[];
  /** Compact badge display for list rows */
  variant?: "badge" | "inline" | "full";
  /** Optional class for styling */
  className?: string;
  /** Whether the splits are expandable */
  collapsible?: boolean;
  /** Default expanded state for collapsible */
  defaultExpanded?: boolean;
}

/**
 * Badge variant - compact indicator for list views
 */
function SplitBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full flex items-center gap-0.5",
        className,
      )}
    >
      <Split className="h-2.5 w-2.5" aria-hidden="true" />
      Split ({count})
    </span>
  );
}

/**
 * Inline variant - shows splits in a horizontal layout
 */
function SplitInline({
  splits,
  className,
}: {
  splits: SplitItem[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {splits.map((split, index) => (
        <div
          key={split.id || index}
          className="flex items-center gap-1.5 text-xs bg-muted/50 px-2 py-1 rounded"
        >
          <span className="font-medium">{formatSplitAmount(split.amount)}</span>
          <span className="text-muted-foreground">→</span>
          <span>{split.categoryName || "Unknown"}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Full variant - detailed list view for modals
 */
function SplitFull({
  splits,
  className,
}: {
  splits: SplitItem[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Split
          className="h-4 w-4 text-purple-600 dark:text-purple-400"
          aria-hidden="true"
        />
        <span>Split Transaction ({splits.length} parts)</span>
      </div>
      <div className="border rounded-lg divide-y divide-border/50">
        {splits.map((split, index) => (
          <div
            key={split.id || index}
            className="flex items-center justify-between px-3 py-2 text-sm"
          >
            <div className="flex-1">
              <div className="font-medium">
                {split.categoryName || "Unknown Category"}
              </div>
              {split.notes && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {split.notes}
                </div>
              )}
            </div>
            <div className="font-medium tabular-nums">
              {formatSplitAmount(split.amount)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Main SplitDetails component - renders appropriate variant
 */
export function SplitDetails({
  splits,
  variant = "badge",
  className,
  collapsible = false,
  defaultExpanded = false,
}: SplitDetailsProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!splits || splits.length === 0) {
    return null;
  }

  // Badge variant - always just show the badge
  if (variant === "badge") {
    return <SplitBadge count={splits.length} className={className} />;
  }

  // Non-collapsible variants
  if (!collapsible) {
    if (variant === "inline") {
      return <SplitInline splits={splits} className={className} />;
    }
    return <SplitFull splits={splits} className={className} />;
  }

  // Collapsible wrapper for inline and full variants
  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={cn("space-y-2", className)}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors w-full justify-between">
          <div className="flex items-center gap-2">
            <Split
              className="h-4 w-4 text-purple-600 dark:text-purple-400"
              aria-hidden="true"
            />
            <span>Split Transaction ({splits.length} parts)</span>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-slide-down data-[state=closed]:animate-slide-up">
          {variant === "inline" ? (
            <SplitInline splits={splits} />
          ) : (
            <SplitFull splits={splits} />
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default SplitDetails;
