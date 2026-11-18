import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { RuleCondition } from "../types";
import type { RulePreviewTransaction } from "@/hooks/use-settings";

interface PreviewTabProps {
  enabledConditions: RuleCondition[];
  previewMutation: {
    isPending: boolean;
    data?: {
      matchCount: number;
      totalScanned: number;
      transactions: RulePreviewTransaction[];
    };
  };
  categories: Array<{ id: string; name: string }>;
}

export function PreviewTab({
  enabledConditions,
  previewMutation,
  categories,
}: PreviewTabProps) {
  if (previewMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4" role="status" aria-label="Loading preview">
        <Loader2 className="w-8 h-8 animate-spin text-rose-400" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          Finding matching transactions...
        </p>
      </div>
    );
  }

  if (enabledConditions.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        <p className="text-muted-foreground">
          Enable at least one condition to see a preview.
        </p>
      </div>
    );
  }

  if (previewMutation.data?.matchCount === 0) {
    return (
      <div className="text-center py-12 space-y-2" role="status" aria-live="polite">
        <p className="font-medium text-rose-500">No matches found</p>
        <p className="text-sm text-muted-foreground">
          Try adjusting your conditions or changing the logic to "ANY".
        </p>
        <p className="text-xs text-muted-foreground pt-2">
          Scanned {previewMutation.data.totalScanned} recent transactions.
        </p>
      </div>
    );
  }

  if (previewMutation.data) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur py-2 z-10 border-b mb-4">
          <div className="text-sm font-medium" role="status" aria-live="polite" aria-atomic="true">
            Found {previewMutation.data.matchCount} matching{" "}
            {previewMutation.data.matchCount === 1
              ? "transaction"
              : "transactions"}
          </div>
          <div className="text-xs text-muted-foreground">
            Scanned {previewMutation.data.totalScanned} recent
          </div>
        </div>

        <div className="space-y-2" role="region" aria-label="Matching transactions list">
          {previewMutation.data.transactions.map((txn) => (
            <div
              key={txn.id}
              className="flex items-center justify-between p-3 rounded-lg border bg-accent/10 hover:bg-accent/20 transition-colors"
            >
              <div className="space-y-1">
                <div className="text-sm font-medium">{txn.name}</div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{format(new Date(txn.date), "MMM d, yyyy")}</span>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span className="capitalize">{txn.type}</span>
                  {txn.categoryId && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                      <span>
                        {categories.find((c) => c.id === txn.categoryId)
                          ?.name || "Uncategorized"}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div
                className={cn(
                  "text-sm font-semibold",
                  txn.type === "income" ? "text-green-600" : "text-rose-600"
                )}
              >
                {txn.type === "income" ? "+" : "-"}
                {Number(txn.amount).toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-12 text-muted-foreground">
      Something went wrong while fetching the preview.
    </div>
  );
}
