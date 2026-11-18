import React from "react";
import { CategoryGroup, Category } from "@shared/schema";
import { GroupSection } from "./GroupSection";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

interface TypeSectionProps {
  type: "income" | "expenses" | "transfers";
  groups: CategoryGroup[];
  categories: Category[];
  onCreateGroup: (type: string) => void;
  onEditGroup: (group: CategoryGroup) => void;
  onCreateCategory: (groupId: string) => void;
  onEditCategory: (category: Category) => void;
  onReorderCategories: (groupId: string, orderedIds: string[]) => void;
  showArchived: boolean;
}

const TYPE_CONFIG = {
  income: {
    label: "Income",
    emptyMessage: "No income groups yet",
  },
  expenses: {
    label: "Expenses",
    emptyMessage: "No expense groups yet",
  },
  transfers: {
    label: "Transfers",
    emptyMessage: "No transfer groups yet",
  },
};

export const TypeSection: React.FC<TypeSectionProps> = ({
  type,
  groups,
  categories,
  onCreateGroup,
  onEditGroup,
  onCreateCategory,
  onEditCategory,
  onReorderCategories,
  showArchived,
}) => {
  const config = TYPE_CONFIG[type];

  const visibleGroups = showArchived
    ? groups
    : groups.filter((group) => !group.isArchived);

  // Sort groups by displayOrder
  const sortedGroups = [...visibleGroups].sort(
    (a, b) => a.displayOrder - b.displayOrder
  );

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">{config.label}</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCreateGroup(type)}
          className="text-primary hover:text-primary/80"
        >
          Create group
        </Button>
      </div>

      <div className="space-y-1">
        {sortedGroups.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            categories={categories.filter((c) => c.groupId === group.id)}
            onEditGroup={onEditGroup}
            onCreateCategory={onCreateCategory}
            onEditCategory={onEditCategory}
            onReorderCategories={(orderedIds) =>
              onReorderCategories(group.id, orderedIds)
            }
            showArchived={showArchived}
          />
        ))}

        {sortedGroups.length === 0 && (
          <div className="text-center py-8 bg-muted rounded-lg border border-dashed text-muted-foreground">
            {config.emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
};
