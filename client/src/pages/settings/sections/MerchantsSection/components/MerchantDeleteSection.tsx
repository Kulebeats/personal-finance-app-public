import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";

type MerchantDeleteSectionProps = {
  state: MerchantsSectionState;
};

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
        onValueChange={(value) =>
          actions.setDeleteAction(value as "soft" | "hard" | "merge")
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Select action" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="soft">Archive (soft delete)</SelectItem>
          <SelectItem value="hard">Delete permanently</SelectItem>
          <SelectItem value="merge">Merge into another</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {viewState.deleteAction === "soft" &&
          "Archives the merchant while keeping transactions."}
        {viewState.deleteAction === "merge" &&
          "Moves transactions to the selected merchant."}
        {viewState.deleteAction === "hard" &&
          "Permanently deletes this merchant and its aliases."}
      </p>
      <p className="text-xs text-muted-foreground">
        {derived.deleteTransactionCount} transactions currently reference
        this merchant.
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
      {viewState.deleteAction !== "hard" && (
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
      )}
      {viewState.deleteAction === "hard" && (
        <div className="space-y-2">
          <Label>Type DELETE to confirm</Label>
          <Input
            value={viewState.deleteConfirmText}
            onChange={(event) =>
              actions.setDeleteConfirmText(event.target.value)
            }
            placeholder="DELETE"
          />
          <div className="flex items-start gap-2">
            <input
              id="merchant-delete-hard-ack"
              type="checkbox"
              checked={viewState.deleteAcknowledged}
              onChange={(event) =>
                actions.setDeleteAcknowledged(event.target.checked)
              }
            />
            <Label
              htmlFor="merchant-delete-hard-ack"
              className="text-xs text-muted-foreground"
            >
              I understand this permanently deletes the merchant.
            </Label>
          </div>
        </div>
      )}
    </div>
  );
}
