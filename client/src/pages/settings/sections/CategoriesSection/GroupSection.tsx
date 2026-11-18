import React from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CategoryGroup, Category } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { DraggableCategoryItem } from "./DraggableCategoryItem";

interface GroupSectionProps {
  group: CategoryGroup;
  categories: Category[];
  onEditGroup: (group: CategoryGroup) => void;
  onCreateCategory: (groupId: string) => void;
  onEditCategory: (category: Category) => void;
  onReorderCategories: (orderedIds: string[]) => void;
  showArchived: boolean;
}

export const GroupSection: React.FC<GroupSectionProps> = ({
  group,
  categories,
  onEditGroup,
  onCreateCategory,
  onEditCategory,
  onReorderCategories,
  showArchived,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const filteredCategories = categories.filter(
    (c) => showArchived || !c.isArchived,
  );

  // We only sort the filtered categories for display, but reorder logic should handle indices correctly.
  // Actually, standard practice: if we reorder visible items, we might need to be careful if hidden items exist.
  // For now, let's assume reorder only affects what's visible or simple reorder.
  // Better approach: Reorder updates displayOrder.

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = categories.findIndex((c) => c.id === active.id);
      const newIndex = categories.findIndex((c) => c.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(categories, oldIndex, newIndex);
        onReorderCategories(newOrder.map((c) => c.id));
      }
    }
  };

  return (
    <div className="mb-6">
      {/* Group Header */}
      <div className="flex items-center justify-between py-2 px-1 mb-1 group/header">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm text-foreground">
            {group.name}
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground opacity-0 group-hover/header:opacity-100 transition-opacity"
          onClick={() => onEditGroup(group)}
        >
          Edit
        </Button>
      </div>

      {/* Categories List */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="bg-muted/30 rounded-lg p-1 min-h-[50px] border border-transparent transition-colors hover:border-border">
          <SortableContext
            items={filteredCategories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {filteredCategories.map((category) => (
              <DraggableCategoryItem
                key={category.id}
                category={category}
                onEdit={onEditCategory}
                isArchived={category.isArchived || false}
              />
            ))}
          </SortableContext>

          {/* Create Category Button */}
          <button
            onClick={() => onCreateCategory(group.id)}
            className="w-full flex items-center gap-2 py-2 px-3 mt-1 rounded-md text-sm text-muted-foreground hover:text-primary hover:bg-muted transition-colors group"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded bg-transparent group-hover:bg-muted transition-colors">
              <Plus className="h-4 w-4" />
            </div>
            <span>Create Category</span>
          </button>
        </div>
      </DndContext>
    </div>
  );
};
