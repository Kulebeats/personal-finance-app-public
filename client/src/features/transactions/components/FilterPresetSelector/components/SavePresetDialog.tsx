/**
 * Save the current Transactions filters as a named preset (R11 / ORG-010).
 */
import { toastActionError } from "@/lib/actionErrorToast";
import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { TransactionFilters } from "../../../types";
import { transactionFiltersToPreset } from "../../../filterPresetFilters";
import { useCreateFilterPreset, type FilterPreset } from "../../../hooks/useFilterPresets";

interface SavePresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: FilterPreset["context"];
  currentFilters: TransactionFilters;
}

export function SavePresetDialog({ open, onOpenChange, context, currentFilters }: SavePresetDialogProps) {
  const [presetName, setPresetName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const createPreset = useCreateFilterPreset();
  const name = presetName.trim();

  const close = () => {
    onOpenChange(false);
    setPresetName("");
    setIsDefault(false);
    setIsShared(false);
  };

  const handleSave = async () => {
    if (!name) {
      toast.error("Please enter a preset name");
      return;
    }
    try {
      await createPreset.mutateAsync({
        name,
        context,
        filters: transactionFiltersToPreset(currentFilters),
        isDefault,
        isShared,
      });
      toast.success(`Saved preset "${name}"`);
      close();
    } catch (error) {
      toastActionError("Failed to save preset", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Filter Preset</DialogTitle>
          <DialogDescription>Save your current filter settings for quick access later.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="preset-name">Preset Name</Label>
            <Input
              id="preset-name"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="e.g., Monthly Groceries"
              maxLength={100}
              autoFocus
            />
          </div>

          <div className="flex items-start space-x-2">
            <Checkbox
              id="is-default"
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
              aria-describedby="is-default-hint"
            />
            <div className="space-y-1">
              <Label htmlFor="is-default" className="text-sm font-normal">Set as default preset</Label>
              <p id="is-default-hint" className="text-xs text-muted-foreground">
                Applied when you open Transactions, and when you clear filters.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox id="is-shared" checked={isShared} onCheckedChange={(checked) => setIsShared(checked === true)} />
            <Label htmlFor="is-shared" className="text-sm font-normal">Share with household members</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={createPreset.isPending || !name}>
              {createPreset.isPending ? "Saving..." : <><Check className="h-4 w-4 mr-2" />Save Preset</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
