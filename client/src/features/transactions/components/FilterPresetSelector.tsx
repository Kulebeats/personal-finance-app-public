/**
 * FilterPresetSelector Component
 *
 * Dropdown to select saved filter presets with ability to save current filters.
 *
 * @module features/transactions/components/FilterPresetSelector
 */

import { useState } from "react";
import {
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  Star,
  Trash2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { TransactionFilters } from "../types";
import {
  useFilterPresets,
  useCreateFilterPreset,
  useDeleteFilterPreset,
  type FilterPreset,
} from "../hooks/useFilterPresets";

interface FilterPresetSelectorProps {
  context: "transactions" | "reports" | "budget" | "cashflow";
  currentFilters: TransactionFilters;
  onSelectPreset: (filters: TransactionFilters) => void;
  className?: string;
}

export function FilterPresetSelector({
  context,
  currentFilters,
  onSelectPreset,
  className,
}: FilterPresetSelectorProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isShared, setIsShared] = useState(false);

  const { data: presets = [], isLoading } = useFilterPresets(context);
  const createPreset = useCreateFilterPreset();
  const deletePreset = useDeleteFilterPreset();

  const handleSelectPreset = (preset: FilterPreset) => {
    onSelectPreset(preset.filters);
    toast.success(`Applied preset "${preset.name}"`);
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) {
      toast.error("Please enter a preset name");
      return;
    }

    try {
      await createPreset.mutateAsync({
        name: presetName.trim(),
        context,
        filters: currentFilters as unknown as Record<string, unknown>,
        isDefault,
        isShared,
      });
      toast.success(`Saved preset "${presetName}"`);
      setSaveDialogOpen(false);
      setPresetName("");
      setIsDefault(false);
      setIsShared(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save preset",
      );
    }
  };

  const handleDeletePreset = async (
    preset: FilterPreset,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    try {
      await deletePreset.mutateAsync({ id: preset.id, context });
      toast.success(`Deleted preset "${preset.name}"`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete preset",
      );
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("gap-2", className)}
            disabled={isLoading}
          >
            <Bookmark className="h-4 w-4" />
            <span className="hidden sm:inline">Presets</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {presets.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              No saved presets
            </div>
          ) : (
            presets.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onClick={() => handleSelectPreset(preset)}
                className="flex items-center justify-between group"
              >
                <div className="flex items-center gap-2">
                  {preset.isDefault && (
                    <Star
                      className="h-3 w-3 text-amber-500"
                      aria-label="Default preset"
                    />
                  )}
                  <span>{preset.name}</span>
                  {preset.isShared && (
                    <span className="text-xs text-muted-foreground">
                      (shared)
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => handleDeletePreset(preset, e)}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setSaveDialogOpen(true)}
            className="gap-2 text-primary"
          >
            <BookmarkPlus className="h-4 w-4" />
            Save current filters
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save Preset Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Filter Preset</DialogTitle>
            <DialogDescription>
              Save your current filter settings for quick access later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="preset-name">Preset Name</Label>
              <Input
                id="preset-name"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="e.g., Monthly Groceries"
                autoFocus
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-default"
                checked={isDefault}
                onCheckedChange={(checked) => setIsDefault(checked === true)}
              />
              <Label htmlFor="is-default" className="text-sm font-normal">
                Set as default preset
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-shared"
                checked={isShared}
                onCheckedChange={(checked) => setIsShared(checked === true)}
              />
              <Label htmlFor="is-shared" className="text-sm font-normal">
                Share with household members
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePreset}
              disabled={createPreset.isPending || !presetName.trim()}
            >
              {createPreset.isPending ? (
                "Saving..."
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Save Preset
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
