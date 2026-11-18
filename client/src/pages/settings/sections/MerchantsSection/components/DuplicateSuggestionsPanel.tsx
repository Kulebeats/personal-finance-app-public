import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";

type DuplicateSuggestionsPanelProps = {
  state: MerchantsSectionState;
};

export function DuplicateSuggestionsPanel({
  state,
}: DuplicateSuggestionsPanelProps) {
  const { derived, state: viewState, actions } = state;

  if (derived.duplicateSuggestions.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Possible duplicates</p>
          <p className="text-xs text-muted-foreground">
            These merchants have similar names. Merge them to keep your list
            clean.
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {derived.duplicateSuggestions.map((group) => {
          const groupKey = actions.getDuplicateKey(group.merchants);
          const targetId =
            viewState.duplicateTargets[groupKey] ||
            group.merchants[0]?.id ||
            "";
          const isMerging = viewState.mergingDuplicateKey === groupKey;
          return (
            <div
              key={groupKey}
              className="flex flex-col gap-3 rounded-md bg-background p-3"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Similarity</span>
                <span>{group.similarity ?? 0}%</span>
              </div>
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                {group.merchants.map((merchant, index) => (
                  <span key={merchant.id}>
                    {merchant.name}
                    {index < group.merchants.length - 1 ? " -> " : ""}
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Select
                  value={targetId}
                  onValueChange={(value) =>
                    actions.setDuplicateTargets((prev) => ({
                      ...prev,
                      [groupKey]: value,
                    }))
                  }
                >
                  <SelectTrigger className="sm:w-[260px]">
                    <SelectValue placeholder="Select primary merchant" />
                  </SelectTrigger>
                  <SelectContent>
                    {group.merchants.map((merchant) => (
                      <SelectItem key={merchant.id} value={merchant.id}>
                        {merchant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => actions.openMergePreview(group)}
                  disabled={isMerging}
                >
                  {isMerging ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Merging...
                    </>
                  ) : (
                    "Review merge"
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
