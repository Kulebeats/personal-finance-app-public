import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type {
  MerchantFormState,
  MerchantsSectionState,
} from "../hooks/useMerchantsSectionState";
import { MerchantFormFields } from "./MerchantFormFields";
import { MerchantDeleteSection } from "./MerchantDeleteSection";

type MerchantFormDialogProps = {
  state: MerchantsSectionState;
};

export function MerchantFormDialog({ state }: MerchantFormDialogProps) {
  const { state: viewState, derived, actions, mutations } = state;
  const updateForm = (patch: Partial<MerchantFormState>) =>
    actions.setMerchantForm((prev) => ({ ...prev, ...patch }));

  return (
    <Dialog open={viewState.isDialogOpen} onOpenChange={actions.setDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {viewState.editingMerchant ? "Edit Merchant" : "Add Merchant"}
          </DialogTitle>
          <DialogDescription>Update merchant details and defaults.</DialogDescription>
        </DialogHeader>

        <MerchantFormFields state={state} updateForm={updateForm} />
        <MerchantDeleteSection state={state} />

        <DialogFooter className="flex justify-between sm:justify-between">
          {viewState.editingMerchant ? (
            <Button
              type="button"
              variant="destructive"
              onClick={actions.handleDeleteMerchant}
              disabled={
                mutations.deleteMerchant.isPending ||
                (viewState.deleteAction === "merge" && !viewState.mergeTarget) ||
                (viewState.deleteAction === "hard" &&
                  viewState.deleteConfirmText.trim() !== "DELETE") ||
                !viewState.deleteAcknowledged
              }
            >
              Delete
            </Button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => actions.setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={actions.handleSaveMerchant}
              disabled={!viewState.merchantForm.name.trim() || derived.isSaving}
            >
              {derived.isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
