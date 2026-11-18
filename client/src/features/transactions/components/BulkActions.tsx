/**
 * Bulk Actions Component
 *
 * Toolbar for bulk operations on selected transactions.
 */

import { X, Tag, Check, Trash2, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BulkActionsProps {
  selectedCount: number;
  onClear: () => void;
  onCategorize: () => void;
  onTag: () => void;
  onReview: () => void;
  onDelete: () => void;
  isLoading?: boolean;
}

export function BulkActions({
  selectedCount,
  onClear,
  onCategorize,
  onTag,
  onReview,
  onDelete,
  isLoading = false,
}: BulkActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg px-4 py-2 flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground mr-2">
          {selectedCount} selected
        </span>

        <Button
          variant="ghost"
          size="sm"
          onClick={onCategorize}
          disabled={isLoading}
          className="h-8"
        >
          <FolderOpen className="h-4 w-4 mr-1" />
          Categorize
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onTag}
          disabled={isLoading}
          className="h-8"
        >
          <Tag className="h-4 w-4 mr-1" />
          Tag
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onReview}
          disabled={isLoading}
          className="h-8"
        >
          <Check className="h-4 w-4 mr-1" />
          Review
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={isLoading}
          className="h-8 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          Delete
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          className="h-8 w-8"
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
