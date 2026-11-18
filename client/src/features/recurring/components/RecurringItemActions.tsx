/**
 * RecurringItemActions Component
 *
 * Dropdown action menu for recurring transaction items.
 */

import {
  MoreHorizontal,
  Pause,
  Play,
  Pencil,
  Trash2,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RecurringTransaction } from "@/hooks/useRecurring";

interface RecurringItemActionsProps {
  item: RecurringTransaction;
  onPauseToggle: (item: RecurringTransaction) => void;
  onEdit: (item: RecurringTransaction) => void;
  onDelete: (item: RecurringTransaction) => void;
  onSkip: (item: RecurringTransaction) => void;
}

export function RecurringItemActions({
  item,
  onPauseToggle,
  onEdit,
  onDelete,
  onSkip,
}: RecurringItemActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Actions"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onSkip(item)}>
          <SkipForward className="mr-2 h-4 w-4" aria-hidden="true" /> Skip next
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPauseToggle(item)}>
          {item.isPaused ? (
            <>
              <Play className="mr-2 h-4 w-4" aria-hidden="true" /> Resume
            </>
          ) : (
            <>
              <Pause className="mr-2 h-4 w-4" aria-hidden="true" /> Pause
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(item)}>
          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(item)}
          className="text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
