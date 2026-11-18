import React, { useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Category } from "@shared/schema";

interface DraggableCategoryItemProps {
  category: Category;
  onEdit: (category: Category) => void;
  isArchived: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export const DraggableCategoryItem: React.FC<DraggableCategoryItemProps> = ({
  category,
  onEdit,
  isArchived,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: category.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isArchived ? 0.6 : 1,
  };

  // Keyboard handler for drag handle - supports arrow keys for reordering
  const handleDragHandleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowUp":
          if (!isFirst && onMoveUp) {
            event.preventDefault();
            onMoveUp();
          }
          break;
        case "ArrowDown":
          if (!isLast && onMoveDown) {
            event.preventDefault();
            onMoveDown();
          }
          break;
        case " ":
        case "Enter":
          // Allow dnd-kit to handle space/enter for drag activation
          break;
      }
    },
    [isFirst, isLast, onMoveUp, onMoveDown]
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 py-2 px-3 rounded-md bg-card border border-transparent hover:border-border hover:shadow-sm transition-all group mb-1",
        isDragging && "shadow-md border-blue-200 z-10",
      )}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground/50 hover:text-foreground/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
        aria-label={`Reorder ${category.name}. Use arrow keys to move, or drag to reorder.`}
        onKeyDown={handleDragHandleKeyDown}
        {...listeners}
        {...attributes}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>

      <div
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-lg shrink-0 transition-colors",
          !category.color && "bg-muted",
        )}
        style={{
          backgroundColor: category.color ? `${category.color}20` : undefined, // 20 = 12% opacity
          color: category.color ?? undefined,
        }}
      >
        {category.icon ? (
          <span className="text-xl leading-none select-none filter drop-shadow-sm">
            {category.icon}
          </span>
        ) : (
          <span
            className="text-sm font-semibold"
            style={{ color: category.color ?? undefined }}
          >
            {category.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onEdit(category)}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-medium truncate",
              isArchived && "line-through text-muted-foreground",
            )}
          >
            {category.name}
          </span>
          {isArchived && (
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Archived
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onEdit(category)}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-2 text-muted-foreground hover:text-primary transition-all rounded-full hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Edit ${category.name} category`}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
