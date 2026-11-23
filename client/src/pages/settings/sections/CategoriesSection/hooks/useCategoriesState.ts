import { useMemo, useState } from "react";
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useSeedCategories,
  useCreateCategoryGroup,
  useUpdateCategoryGroup,
  useArchiveCategoryGroup,
  useRestoreCategoryGroup,
  useReorderCategories,
} from "@/hooks/use-settings";
import type { Category, CategoryGroup } from "@shared/schema";
import { useCalendarYearMonth } from "@/lib/calendarZone";
import { CategoryFormState, GroupFormState } from "../types";

/**
 * Custom hook for managing CategoriesSection state and actions.
 * Extracts form state management and CRUD handlers from the main component.
 */
export function useCategoriesState() {
  // "This month" is the household calendar's month, never the browser's (NEW-15).
  const { year, month } = useCalendarYearMonth();
  const categoriesQuery = useMemo(
    () => ({
      includeArchived: true,
      includeStats: true,
      month,
      year,
    }),
    [month, year],
  );

  const { data, isLoading } = useCategories(categoriesQuery);
  const categories = (data?.categories ?? []) as unknown as Category[];
  const groups = (data?.groups ?? []) as unknown as CategoryGroup[];

  const [showArchived, setShowArchived] = useState(false);

  // Mutations
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const seedCategories = useSeedCategories();
  const reorderCategories = useReorderCategories();

  const createGroup = useCreateCategoryGroup();
  const updateGroup = useUpdateCategoryGroup();
  const archiveGroup = useArchiveCategoryGroup();
  const restoreGroup = useRestoreCategoryGroup();

  // Dialog state
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingGroup, setEditingGroup] = useState<CategoryGroup | null>(null);
  const [isCategoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [isGroupDialogOpen, setGroupDialogOpen] = useState(false);

  // Categorize by type
  const categoriesByType = useMemo(() => {
    const byType = {
      income: [] as CategoryGroup[],
      expenses: [] as CategoryGroup[],
      transfers: [] as CategoryGroup[],
    };

    if (!groups) return byType;

    groups.forEach((group) => {
      if (group.type === "income") byType.income.push(group);
      else if (group.type === "expenses") byType.expenses.push(group);
      else if (group.type === "transfers") byType.transfers.push(group);
    });

    return byType;
  }, [groups]);

  // Default group ID
  const defaultGroupId = useMemo(() => {
    return groups.find((group) => !group.isArchived)?.id || "";
  }, [groups]);

  // Form state
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>({
    name: "",
    groupId: "",
    icon: "",
    color: "#6B7280",
    includeInBudget: true,
    rolloverEnabled: false,
    rolloverStartBalance: "",
  });

  const [groupForm, setGroupForm] = useState<GroupFormState>({
    name: "",
    type: "expenses",
    budgetMode: "by_category",
    rolloverEnabled: false,
  });

  // Actions
  const openCreateCategory = (preselectedGroupId?: string) => {
    setEditingCategory(null);
    setCategoryForm({
      name: "",
      groupId: preselectedGroupId || defaultGroupId,
      icon: "",
      color: "#6B7280",
      includeInBudget: true,
      rolloverEnabled: false,
      rolloverStartBalance: "",
    });
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (category: Category) => {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name,
      groupId: category.groupId ?? "",
      icon: category.icon || "",
      color: category.color || "#6B7280",
      includeInBudget: category.includeInBudget ?? true,
      rolloverEnabled: category.rolloverEnabled ?? false,
      rolloverStartBalance: category.rolloverStartBalance
        ? String(category.rolloverStartBalance)
        : "",
    });
    setCategoryDialogOpen(true);
  };

  const openCreateGroup = (type: string = "expenses") => {
    setEditingGroup(null);
    setGroupForm({
      name: "",
      type: type as GroupFormState["type"],
      budgetMode: "by_category",
      rolloverEnabled: false,
    });
    setGroupDialogOpen(true);
  };

  const openEditGroup = (group: CategoryGroup) => {
    setEditingGroup(group);
    setGroupForm({
      name: group.name,
      type: (group.type ?? "expenses") as GroupFormState["type"],
      budgetMode: (group.budgetMode ??
        "by_category") as GroupFormState["budgetMode"],
      rolloverEnabled: group.rolloverEnabled || false,
    });
    setGroupDialogOpen(true);
  };

  const handleSaveCategory = () => {
    if (!categoryForm.name.trim() || !categoryForm.groupId) return;

    const payload = {
      groupId: categoryForm.groupId,
      name: categoryForm.name.trim(),
      icon: categoryForm.icon ? categoryForm.icon.trim() : undefined,
      color: categoryForm.color || undefined,
      includeInBudget: categoryForm.includeInBudget,
      rolloverEnabled: categoryForm.rolloverEnabled,
      rolloverStartBalance: categoryForm.rolloverStartBalance || null,
    };

    if (editingCategory) {
      updateCategory.mutate({ id: editingCategory.id, data: payload });
    } else {
      createCategory.mutate(payload);
    }

    setCategoryDialogOpen(false);
  };

  const handleSaveGroup = () => {
    if (!groupForm.name.trim()) return;

    const payload = {
      name: groupForm.name.trim(),
      type: groupForm.type,
      budgetMode: groupForm.budgetMode,
      rolloverEnabled: groupForm.rolloverEnabled,
    };

    if (editingGroup) {
      updateGroup.mutate({ id: editingGroup.id, data: payload });
    } else {
      createGroup.mutate(payload);
    }

    setGroupDialogOpen(false);
  };

  const handleCategoryDelete = () => {
    if (editingCategory) {
      deleteCategory.mutate(editingCategory.id);
      setCategoryDialogOpen(false);
    }
  };

  const handleCategoryRestore = () => {
    if (editingCategory) {
      updateCategory.mutate(
        { id: editingCategory.id, data: { isArchived: false } },
        { onSuccess: () => setCategoryDialogOpen(false) },
      );
    }
  };

  const handleDeleteGroup = () => {
    if (editingGroup) {
      archiveGroup.mutate(editingGroup.id);
      setGroupDialogOpen(false);
    }
  };

  const handleRestoreGroup = () => {
    if (editingGroup) {
      restoreGroup.mutate(editingGroup.id);
      setGroupDialogOpen(false);
    }
  };

  const handleReorderCategories = (groupId: string, orderedIds: string[]) => {
    const orders = orderedIds.map((id, index) => ({
      id,
      displayOrder: index + 1,
    }));
    reorderCategories.mutate(orders);
  };

  const hasCategories = categories.length > 0;
  const isSeeding = seedCategories.isPending;

  return {
    // Data
    categories,
    groups,
    categoriesByType,
    isLoading,
    hasCategories,
    isSeeding,
    showArchived,
    setShowArchived,

    // Dialog state
    isCategoryDialogOpen,
    setCategoryDialogOpen,
    isGroupDialogOpen,
    setGroupDialogOpen,
    editingCategory,
    editingGroup,

    // Form state
    categoryForm,
    setCategoryForm,
    groupForm,
    setGroupForm,

    // Actions
    openCreateCategory,
    openEditCategory,
    openCreateGroup,
    openEditGroup,
    handleSaveCategory,
    handleSaveGroup,
    handleCategoryDelete,
    handleCategoryRestore,
    handleDeleteGroup,
    handleRestoreGroup,
    handleReorderCategories,
    seedCategories: seedCategories.mutate,
  };
}
