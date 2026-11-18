import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";

type BulkMergePanelProps = {
  state: MerchantsSectionState;
};

export function BulkMergePanel({ state }: BulkMergePanelProps) {
  const { derived, state: viewState, actions } = state;

  if (derived.bulkSelectedIds.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Bulk merge</p>
          <p className="text-xs text-muted-foreground">
            {derived.bulkSelectedIds.length} merchants selected.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={actions.selectAllVisible}
          >
            Select visible
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={actions.clearBulkSelection}
          >
            Clear selection
          </Button>
        </div>
      </div>
      {derived.bulkSelectedIds.length >= 2 ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={viewState.bulkMergeTarget}
            onValueChange={actions.setBulkMergeTarget}
          >
            <SelectTrigger className="sm:w-[280px]">
              <SelectValue placeholder="Select primary merchant" />
            </SelectTrigger>
            <SelectContent>
              {derived.bulkSelectedMerchants.map((merchant) => (
                <SelectItem key={merchant.id} value={merchant.id}>
                  {merchant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={() =>
              actions.openMergePreview(
                { merchants: derived.bulkSelectedMerchants },
                {
                  targetId:
                    viewState.bulkMergeTarget ||
                    derived.bulkSelectedMerchants[0]?.id ||
                    "",
                }
              )
            }
            disabled={!viewState.bulkMergeTarget}
          >
            Review merge
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Select at least two merchants to start a bulk merge.
        </p>
      )}
    </div>
  );
}
