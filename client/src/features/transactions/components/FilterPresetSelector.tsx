/**
 * FilterPresetSelector Component
 *
 * Dropdown to apply a saved filter preset, save the current filters, or open
 * "Manage presets" to delete one (R11 / ORG-010). Every action is a menu item
 * or dialog control, so it is reachable from the keyboard.
 *
 * @module features/transactions/components/FilterPresetSelector
 */

import { useState } from "react";
import { Bookmark, BookmarkPlus, ChevronDown, Settings2, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TransactionFilters } from "../types";
import { presetToTransactionFilters } from "../filterPresetFilters";
import { useFilterPresets, type FilterPreset } from "../hooks/useFilterPresets";
import { SavePresetDialog } from "./FilterPresetSelector/components/SavePresetDialog";
import { ManagePresetsDialog } from "./FilterPresetSelector/components/ManagePresetsDialog";

interface FilterPresetSelectorProps {
  context: FilterPreset["context"];
  currentFilters: TransactionFilters;
  /** Receives the preset's complete filter state (not a partial update). */
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
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const { data: presets = [], isLoading } = useFilterPresets(context);

  const handleSelectPreset = (preset: FilterPreset) => {
    onSelectPreset(presetToTransactionFilters(preset.filters));
    toast.success(`Applied preset "${preset.name}"`);
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
            aria-label="Filter presets"
          >
            <Bookmark className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Presets</span>
            <ChevronDown className="h-3 w-3 opacity-50" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {presets.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">No saved presets</div>
          ) : (
            presets.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onSelect={() => handleSelectPreset(preset)}
                className="flex items-center gap-2"
              >
                {preset.isDefault && <Star className="h-3 w-3 text-amber-500" aria-hidden="true" />}
                <span>{preset.name}</span>
                {preset.isDefault && <span className="sr-only">, default</span>}
                {preset.isShared && <span className="text-xs text-muted-foreground">(shared)</span>}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaveDialogOpen(true)} className="gap-2 text-primary">
            <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
            Save current filters
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setManageDialogOpen(true)} className="gap-2">
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            Manage presets
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SavePresetDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        context={context}
        currentFilters={currentFilters}
      />
      <ManagePresetsDialog
        open={manageDialogOpen}
        onOpenChange={setManageDialogOpen}
        context={context}
        presets={presets}
      />
    </>
  );
}
