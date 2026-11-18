/**
 * ResponsiveActionBar Component
 *
 * A mobile-friendly action bar that adapts to screen size.
 * - On desktop: horizontal layout with full labels
 * - On mobile: sticky bottom bar with icons and overflow menu
 *
 * @module components/ui/responsive-action-bar
 */

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive" | "ghost" | "outline";
  disabled?: boolean;
  /** Number of items that must be selected for this action */
  minSelected?: number;
}

interface ResponsiveActionBarProps {
  actions: ActionItem[];
  selectedCount: number;
  /** Maximum actions to show before overflow menu (default: 4) */
  maxVisible?: number;
  /** Show sticky on mobile */
  sticky?: boolean;
  className?: string;
}

export function ResponsiveActionBar({
  actions,
  selectedCount,
  maxVisible = 4,
  sticky = true,
  className,
}: ResponsiveActionBarProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);

  // Filter actions based on selection requirements
  const availableActions = actions.filter(
    (action) => !action.minSelected || selectedCount >= action.minSelected,
  );

  if (availableActions.length === 0) {
    return null;
  }

  // Split into visible and overflow
  const visibleActions = availableActions.slice(0, maxVisible);
  const overflowActions = availableActions.slice(maxVisible);

  return (
    <div
      className={cn(
        "flex items-center gap-2 p-2 bg-background/95 backdrop-blur-sm border rounded-lg shadow-sm",
        sticky &&
          "md:relative fixed bottom-4 left-4 right-4 md:bottom-auto md:left-auto md:right-auto z-50",
        className,
      )}
    >
      {/* Selection count indicator */}
      <div className="px-2 py-1 text-sm font-medium text-muted-foreground shrink-0">
        {selectedCount} selected
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {/* Visible actions */}
        {visibleActions.map((action) => (
          <Button
            key={action.id}
            variant={action.variant || "ghost"}
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled}
            className="gap-1.5"
          >
            {action.icon}
            <span className="hidden sm:inline">{action.label}</span>
          </Button>
        ))}

        {/* Overflow menu */}
        {overflowActions.length > 0 && (
          <DropdownMenu open={overflowOpen} onOpenChange={setOverflowOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="px-2">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {overflowActions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  onClick={() => {
                    action.onClick();
                    setOverflowOpen(false);
                  }}
                  disabled={action.disabled}
                  className={cn(
                    "gap-2",
                    action.variant === "destructive" && "text-destructive",
                  )}
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

/**
 * Hook to manage action bar state
 */
export function useActionBar<T extends { id: string }>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(items.map((item) => item.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const isSelected = (id: string) => selectedIds.has(id);

  const selectedItems = items.filter((item) => selectedIds.has(item.id));

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    selectedItems,
    hasSelection: selectedIds.size > 0,
    isAllSelected: selectedIds.size === items.length && items.length > 0,
  };
}
