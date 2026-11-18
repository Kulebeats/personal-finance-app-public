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

type InlineMergePanelProps = {
  state: MerchantsSectionState;
};

export function InlineMergePanel({ state }: InlineMergePanelProps) {
  const { state: viewState, data, actions, mutations } = state;

  if (!viewState.mergeSource) return null;

  return (
    <div className="mt-4 p-4 border rounded-lg bg-amber-50 dark:bg-amber-950">
      <p className="text-sm font-medium mb-2">
        Merge "{data.merchants?.find((m) => m.id === viewState.mergeSource)?.name}
        " with:
      </p>
      <div className="flex gap-2">
        <Select
          value={viewState.mergeTarget}
          onValueChange={actions.setMergeTarget}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select target merchant" />
          </SelectTrigger>
          <SelectContent>
            {data.merchants
              ?.filter((merchant) => merchant.id !== viewState.mergeSource)
              .map((merchant) => (
                <SelectItem key={merchant.id} value={merchant.id}>
                  {merchant.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button
          onClick={actions.handleMerge}
          disabled={!viewState.mergeTarget || mutations.mergeMerchants.isPending}
          size="sm"
        >
          {mutations.mergeMerchants.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Merge"
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            actions.setMergeSource(null);
            actions.setMergeTarget("");
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
