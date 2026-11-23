import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";
import type { DeleteAction } from "../hooks/useMerchantFormDialog";

type MerchantDeleteSectionProps = {
  state: MerchantsSectionState;
};

/**
 * The options match what the server does (ORG-007). Permanent delete is not
 * offered: it has no retention policy yet, and the server refuses it.
 */
const DELETE_OPTIONS: ReadonlyArray<{ value: DeleteAction; label: string }> = [
  { value: "soft", label: "Archive" },
  { value: "merge", label: "Merge into another merchant" },
];

function describeAction(action: DeleteAction, transactionCount: number): string {
  if (action === "merge") {
    return `Moves its ${transactionCount} transactions to the selected merchant and archives this one; its aliases and logo stay with it. You can undo this from Merge history for 30 days.`;
  }
  return `Hides this merchant from lists and matching. It keeps its ${transactionCount} transactions, aliases and logo; switch Active back on to restore it.`;
}

export function MerchantDeleteSection({ state }: MerchantDeleteSectionProps) {
  const { state: viewState, derived, actions } = state;

  if (!viewState.editingMerchant) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label>Delete Action</Label>
      <Select
        value={viewState.deleteAction}
        onValueChange={(value) => actions.setDeleteAction(value as DeleteAction)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select action" />
        </SelectTrigger>
        <SelectContent>
          {DELETE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {describeAction(viewState.deleteAction, derived.deleteTransactionCount)}
      </p>
      {viewState.deleteAction === "merge" && (
        <div className="space-y-2">
          <Select
            value={viewState.mergeTarget}
            onValueChange={actions.setMergeTarget}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select merge target" />
            </SelectTrigger>
            <SelectContent>
              {derived.mergeCandidates.map((merchant) => (
                <SelectItem key={merchant.id} value={merchant.id}>
                  {merchant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {derived.mergeCandidates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Add another merchant before merging.
            </p>
          )}
          {derived.mergeCandidates.length > 0 && !viewState.mergeTarget && (
            <p className="text-xs text-muted-foreground">
              Select a merchant to merge into.
            </p>
          )}
        </div>
      )}
      <div className="flex items-start gap-2 pt-2">
        <input
          id="merchant-delete-ack"
          type="checkbox"
          checked={viewState.deleteAcknowledged}
          onChange={(event) =>
            actions.setDeleteAcknowledged(event.target.checked)
          }
        />
        <Label
          htmlFor="merchant-delete-ack"
          className="text-xs text-muted-foreground"
        >
          {viewState.deleteAction === "merge"
            ? "I understand transactions will be moved to the selected merchant."
            : "I understand this will archive the merchant."}
        </Label>
      </div>
    </div>
  );
}
