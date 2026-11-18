import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Filter } from "lucide-react";
import { CategoryItem } from "./CategoryItem";

import type { Category, CategoryGroup } from "@/hooks/use-settings";

interface CategoryListProps {
  categories: Category[];
  groups: CategoryGroup[];
  onCategoryEdit: (category: Category) => void;
  onCategoryArchive: (categoryId: string) => void;
  onCategoryRestore: (categoryId: string) => void;
  onCategoryDelete: (categoryId: string) => void;
  onCategoryReorder: (
    orders: Array<{ id: string; displayOrder: number }>,
  ) => void;
}

export function CategoryList({
  categories,
  groups,
  onCategoryEdit,
  onCategoryArchive,
  onCategoryRestore,
  onCategoryDelete,
  onCategoryReorder,
}: CategoryListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState<
    "name" | "spent" | "budget" | "transactions" | "order"
  >("order");

  // Task 15.1: Memoized filtering and sorting function
  const filteredAndSortedCategories = useMemo(() => {
    let filtered = categories.filter((category) => {
      // Filter by search term
      const matchesSearch =
        category.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (category.groupName || "")
          .toLowerCase()
          .includes(searchTerm.toLowerCase());

      // Filter by group
      const matchesGroup =
        selectedGroupId === "all" || category.groupId === selectedGroupId;

      // Filter by archived status
      const matchesArchiveFilter = showArchived || !category.isArchived;

      return matchesSearch && matchesGroup && matchesArchiveFilter;
    });

    // Sort categories
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "order":
          return (a.displayOrder || 0) - (b.displayOrder || 0);
        case "name":
          return a.name.localeCompare(b.name);
        case "spent":
          return (b.spent || 0) - (a.spent || 0);
        case "budget":
          return (b.budget || 0) - (a.budget || 0);
        case "transactions":
          return (b.transactionCount || 0) - (a.transactionCount || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [categories, searchTerm, selectedGroupId, showArchived, sortBy]);

  // Task 15.1: Memoized category statistics
  const categoryStats = useMemo(() => {
    const active = categories.filter((c) => !c.isArchived).length;
    const archived = categories.filter((c) => c.isArchived).length;
    const total = categories.length;
    const totalBudget = categories.reduce((sum, c) => sum + (c.budget || 0), 0);
    const totalSpent = categories.reduce((sum, c) => sum + (c.spent || 0), 0);

    return { active, archived, total, totalBudget, totalSpent };
  }, [categories]);

  // Task 15.1: Memoized group statistics
  const groupStats = useMemo(() => {
    return groups.map((group) => {
      const groupCategories = categories.filter(
        (c) => c.groupId === group.id && !c.isArchived,
      );
      const count = groupCategories.length;
      const spent = groupCategories.reduce((sum, c) => sum + (c.spent || 0), 0);
      const budget = groupCategories.reduce(
        (sum, c) => sum + (c.budget || 0),
        0,
      );

      return { ...group, count, spent, budget };
    });
  }, [categories, groups]);

  const handleMove = (categoryId: string, direction: "up" | "down") => {
    const target = categories.find((category) => category.id === categoryId);
    if (!target) return;

    const groupCategories = categories
      .filter(
        (category) =>
          category.groupId === target.groupId &&
          (showArchived || !category.isArchived),
      )
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

    const index = groupCategories.findIndex(
      (category) => category.id === categoryId,
    );
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= groupCategories.length) return;

    const current = groupCategories[index];
    const neighbor = groupCategories[swapIndex];
    if (!current || !neighbor) return;

    const currentOrder = current.displayOrder ?? index;
    const neighborOrder = neighbor.displayOrder ?? swapIndex;

    const orders = [
      { id: current.id, displayOrder: neighborOrder },
      { id: neighbor.id, displayOrder: currentOrder },
    ];

    onCategoryReorder(orders);
  };

  return (
    <div className="space-y-4">
      {/* Search and Filter Controls */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            aria-label="Search categories by name or group"
          />
        </div>

        <div className="flex gap-2">
          <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
            <SelectTrigger
              className="w-40"
              aria-label="Filter categories by group"
            >
              <SelectValue placeholder="All Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={sortBy}
            onValueChange={(value) => setSortBy(value as typeof sortBy)}
          >
            <SelectTrigger className="w-32" aria-label="Sort categories by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="order">Default</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="spent">Spent</SelectItem>
              <SelectItem value="budget">Budget</SelectItem>
              <SelectItem value="transactions">Transactions</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={showArchived ? "default" : "outline"}
            onClick={() => setShowArchived(!showArchived)}
            size="sm"
            aria-label={
              showArchived
                ? "Hide archived categories"
                : "Show archived categories"
            }
          >
            <Filter className="h-4 w-4 mr-2" />
            {showArchived ? "Hide Archived" : "Show Archived"}
          </Button>
        </div>
      </div>

      {/* Category Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="bg-muted p-3 rounded-lg">
          <div className="font-medium">Total Categories</div>
          <div className="text-2xl font-bold">{categoryStats.total}</div>
          <div className="text-muted-foreground">
            {categoryStats.active} active, {categoryStats.archived} archived
          </div>
        </div>

        <div className="bg-muted p-3 rounded-lg">
          <div className="font-medium">Total Budget</div>
          <div className="text-2xl font-bold">
            ${categoryStats.totalBudget.toLocaleString()}
          </div>
        </div>

        <div className="bg-muted p-3 rounded-lg">
          <div className="font-medium">Total Spent</div>
          <div className="text-2xl font-bold">
            ${categoryStats.totalSpent.toLocaleString()}
          </div>
        </div>

        <div className="bg-muted p-3 rounded-lg">
          <div className="font-medium">Filtered Results</div>
          <div className="text-2xl font-bold">
            {filteredAndSortedCategories.length}
          </div>
        </div>
      </div>

      {/* Group Stats (when filtering by specific group) */}
      {selectedGroupId !== "all" && (
        <div className="bg-muted p-4 rounded-lg">
          {(() => {
            const group = groupStats.find((g) => g.id === selectedGroupId);
            return group ? (
              <div>
                <h3 className="font-medium mb-2">{group.name} Group</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Categories: </span>
                    <span className="font-medium">{group.count}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Budget: </span>
                    <span className="font-medium">
                      ${group.budget.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Spent: </span>
                    <span className="font-medium">
                      ${group.spent.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* Category List */}
      <div className="space-y-2">
        {filteredAndSortedCategories.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {searchTerm
              ? "No categories found matching your search."
              : "No categories found."}
          </div>
        ) : (
          filteredAndSortedCategories.map((category) => (
            <CategoryItem
              key={category.id}
              category={category}
              onEdit={() => onCategoryEdit(category)}
              onArchive={() => onCategoryArchive(category.id)}
              onRestore={() => onCategoryRestore(category.id)}
              onDelete={() => onCategoryDelete(category.id)}
              onMoveUp={
                sortBy === "order"
                  ? () => handleMove(category.id, "up")
                  : undefined
              }
              onMoveDown={
                sortBy === "order"
                  ? () => handleMove(category.id, "down")
                  : undefined
              }
              canDelete={(category.transactionCount || 0) === 0}
            />
          ))
        )}
      </div>
    </div>
  );
}
