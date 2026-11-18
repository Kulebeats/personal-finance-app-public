import { Button } from "@/components/ui/button";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";

type MergeHistoryPanelProps = {
  state: MerchantsSectionState;
};

export function MergeHistoryPanel({ state }: MergeHistoryPanelProps) {
  const { data, mutations } = state;
  const history = data.mergeHistory.data || [];

  if (history.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Recent merges</p>
          <p className="text-xs text-muted-foreground">
            Undo merges for a limited time if something went wrong.
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background p-2 text-sm"
          >
            <span>
              {entry.sourceMerchantName} {"-> "}{" "}
              {entry.targetMerchantName || "Target merchant"}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => mutations.undoMerge.mutate(entry.id)}
              disabled={mutations.undoMerge.isPending}
            >
              Undo
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
