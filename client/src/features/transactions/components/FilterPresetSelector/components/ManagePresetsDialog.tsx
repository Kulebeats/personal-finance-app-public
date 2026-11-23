/**
 * List saved presets and delete your own (R11 / ORG-010).
 *
 * Delete lives here as a labelled button rather than inside a dropdown item,
 * so it can be reached with Tab and announced by a screen reader. Only the
 * owner can delete a preset (the server enforces this too); a household
 * member's shared preset is listed without a delete button.
 */
import { toastActionError } from "@/lib/actionErrorToast";
import { Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProfile } from "@/hooks/use-settings";
import { useDeleteFilterPreset, type FilterPreset } from "../../../hooks/useFilterPresets";

interface ManagePresetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: FilterPreset["context"];
  presets: FilterPreset[];
}

export function ManagePresetsDialog({ open, onOpenChange, context, presets }: ManagePresetsDialogProps) {
  const { data: profile } = useProfile();
  const deletePreset = useDeleteFilterPreset();

  const handleDelete = async (preset: FilterPreset) => {
    try {
      await deletePreset.mutateAsync({ id: preset.id, context });
      toast.success(`Deleted preset "${preset.name}"`);
    } catch (error) {
      toastActionError("Failed to delete preset", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Filter Presets</DialogTitle>
          <DialogDescription>Delete presets you no longer need.</DialogDescription>
        </DialogHeader>
        {presets.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No saved presets</p>
        ) : (
          <ul className="divide-y" aria-label="Saved presets">
            {presets.map((preset) => {
              const isOwn = !!profile?.id && preset.userId === profile.id;
              return (
                <li key={preset.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    {preset.isDefault && <Star className="h-3 w-3 text-amber-500" aria-hidden="true" />}
                    {preset.name}
                    {preset.isDefault && <span className="text-xs text-muted-foreground">(default)</span>}
                    {preset.isShared && <span className="text-xs text-muted-foreground">(shared)</span>}
                  </span>
                  {isOwn && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(preset)}
                      disabled={deletePreset.isPending}
                      aria-label={`Delete preset ${preset.name}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
