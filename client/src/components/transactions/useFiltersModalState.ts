import { useEffect, useMemo, useState } from "react";

import { useAccounts } from "@/hooks/useAccounts";
import { useGoals } from "@/hooks/useGoals";
import { useCategories } from "@/hooks/use-finance-data";
import { useMerchants } from "@/hooks/use-settings";
import { useTags } from "@/hooks";

import {
  defaultFilters,
  type FilterItem,
  type FilterSection,
  type TransactionFilters,
} from "./filtersTypes";

type UseFiltersModalStateProps = {
  value: TransactionFilters;
  onChange: (value: TransactionFilters) => void;
};

export function useFiltersModalState({
  value,
  onChange,
}: UseFiltersModalStateProps) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState<TransactionFilters>(value);
  const [activeSection, setActiveSection] = useState<FilterSection>(
    "categories"
  );
  const [searchQuery, setSearchQuery] = useState("");

  const { data: accounts } = useAccounts();
  const { data: goals } = useGoals();
  const { categories } = useCategories();
  const { data: merchants } = useMerchants();
  const { data: tags } = useTags();

  useEffect(() => {
    if (open) {
      setDraftValue(value);
      setSearchQuery("");
    }
  }, [open, value]);

  const categoryItems: FilterItem[] = useMemo(() => {
    if (!categories) return [];
    return [
      { id: "uncategorized", name: "Uncategorized", icon: "?" },
      ...categories.map((category) => ({
        id: category.id,
        name: category.name,
        icon: category.icon || undefined,
        color: category.color || undefined,
      })),
    ];
  }, [categories]);

  const accountItems: FilterItem[] = useMemo(() => {
    if (!accounts) return [];
    return accounts.map((account) => ({
      id: account.id,
      name: account.name,
      color: account.color || undefined,
    }));
  }, [accounts]);

  const goalItems: FilterItem[] = useMemo(() => {
    if (!goals) return [];
    return goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      icon: goal.icon || undefined,
      color: goal.color || undefined,
    }));
  }, [goals]);

  const merchantItems: FilterItem[] = useMemo(() => {
    if (!merchants) return [];
    return merchants.map((merchant) => ({
      id: merchant.id,
      name: merchant.name,
      imageUrl: merchant.logoUrl,
      initials: merchant.name.slice(0, 2).toUpperCase(),
      category: merchant.category ?? null,
    }));
  }, [merchants]);

  const tagItems: FilterItem[] = useMemo(() => {
    if (!tags) return [];
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color || undefined,
    }));
  }, [tags]);

  const currentItems = useMemo(() => {
    switch (activeSection) {
      case "categories":
        return categoryItems;
      case "merchants":
        return merchantItems;
      case "accounts":
        return accountItems;
      case "tags":
        return tagItems;
      case "goals":
        return goalItems;
      default:
        return [];
    }
  }, [
    activeSection,
    categoryItems,
    merchantItems,
    accountItems,
    tagItems,
    goalItems,
  ]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return currentItems;
    const query = searchQuery.toLowerCase();
    return currentItems.filter((item) =>
      item.name.toLowerCase().includes(query)
    );
  }, [currentItems, searchQuery]);

  const showMerchantEmptyState =
    activeSection === "merchants" &&
    !searchQuery.trim() &&
    (merchants?.length ?? 0) === 0;

  const selectedIds = useMemo(() => {
    switch (activeSection) {
      case "categories":
        return draftValue.categoryIds;
      case "merchants":
        return draftValue.merchantIds;
      case "accounts":
        return draftValue.accountIds;
      case "tags":
        return draftValue.tagIds;
      case "goals":
        return draftValue.goalIds;
      default:
        return [];
    }
  }, [activeSection, draftValue]);

  const toggleSelection = (id: string) => {
    if (activeSection === "categories") {
      setDraftValue((prev) => ({
        ...prev,
        categoryIds: prev.categoryIds.includes(id)
          ? prev.categoryIds.filter((item) => item !== id)
          : [...prev.categoryIds, id],
      }));
    } else if (activeSection === "merchants") {
      setDraftValue((prev) => ({
        ...prev,
        merchantIds: prev.merchantIds.includes(id)
          ? prev.merchantIds.filter((item) => item !== id)
          : [...prev.merchantIds, id],
      }));
    } else if (activeSection === "accounts") {
      setDraftValue((prev) => ({
        ...prev,
        accountIds: prev.accountIds.includes(id)
          ? prev.accountIds.filter((item) => item !== id)
          : [...prev.accountIds, id],
      }));
    } else if (activeSection === "tags") {
      setDraftValue((prev) => ({
        ...prev,
        tagIds: prev.tagIds.includes(id)
          ? prev.tagIds.filter((item) => item !== id)
          : [...prev.tagIds, id],
      }));
    } else if (activeSection === "goals") {
      setDraftValue((prev) => ({
        ...prev,
        goalIds: prev.goalIds.includes(id)
          ? prev.goalIds.filter((item) => item !== id)
          : [...prev.goalIds, id],
      }));
    }
  };

  const selectAll = () => {
    const allIds = currentItems.map((item) => item.id);
    if (activeSection === "categories") {
      setDraftValue((prev) => ({ ...prev, categoryIds: allIds }));
    } else if (activeSection === "merchants") {
      setDraftValue((prev) => ({ ...prev, merchantIds: allIds }));
    } else if (activeSection === "accounts") {
      setDraftValue((prev) => ({ ...prev, accountIds: allIds }));
    } else if (activeSection === "tags") {
      setDraftValue((prev) => ({ ...prev, tagIds: allIds }));
    } else if (activeSection === "goals") {
      setDraftValue((prev) => ({ ...prev, goalIds: allIds }));
    }
  };

  const deselectAll = () => {
    if (activeSection === "categories") {
      setDraftValue((prev) => ({ ...prev, categoryIds: [] }));
    } else if (activeSection === "merchants") {
      setDraftValue((prev) => ({ ...prev, merchantIds: [] }));
    } else if (activeSection === "accounts") {
      setDraftValue((prev) => ({ ...prev, accountIds: [] }));
    } else if (activeSection === "tags") {
      setDraftValue((prev) => ({ ...prev, tagIds: [] }));
    } else if (activeSection === "goals") {
      setDraftValue((prev) => ({ ...prev, goalIds: [] }));
    }
  };

  const totalFiltersCount = useMemo(() => {
    let count = 0;
    count += draftValue.categoryIds.length;
    count += draftValue.merchantIds.length;
    count += draftValue.accountIds.length;
    count += draftValue.tagIds.length;
    count += draftValue.goalIds.length;
    count += draftValue.types.length;
    count += draftValue.statuses.length;
    if (draftValue.amountMin !== undefined) count++;
    if (draftValue.amountMax !== undefined) count++;
    if (draftValue.isReviewed !== undefined) count++;
    if (draftValue.isExcludedFromReports !== undefined) count++;
    if (draftValue.isExcludedFromBudget !== undefined) count++;
    if (draftValue.isPrivate !== undefined) count++;
    return count;
  }, [draftValue]);

  const appliedFiltersCount = useMemo(() => {
    let count = 0;
    count += value.categoryIds.length;
    count += value.merchantIds.length;
    count += value.accountIds.length;
    count += value.tagIds.length;
    count += value.goalIds.length;
    count += value.types.length;
    count += value.statuses.length;
    if (value.amountMin !== undefined) count++;
    if (value.amountMax !== undefined) count++;
    if (value.isReviewed !== undefined) count++;
    if (value.isExcludedFromReports !== undefined) count++;
    if (value.isExcludedFromBudget !== undefined) count++;
    if (value.isPrivate !== undefined) count++;
    return count;
  }, [value]);

  const allSelected =
    currentItems.length > 0 && selectedIds.length === currentItems.length;
  const someSelected =
    selectedIds.length > 0 && selectedIds.length < currentItems.length;

  const sections: { key: FilterSection; label: string; count: number }[] = [
    {
      key: "categories",
      label: "Categories",
      count: draftValue.categoryIds.length,
    },
    {
      key: "merchants",
      label: "Merchants",
      count: draftValue.merchantIds.length,
    },
    {
      key: "accounts",
      label: "Accounts",
      count: draftValue.accountIds.length,
    },
    { key: "tags", label: "Tags", count: draftValue.tagIds.length },
    { key: "goals", label: "Goals", count: draftValue.goalIds.length },
    {
      key: "amount",
      label: "Amount",
      count:
        (draftValue.amountMin !== undefined ? 1 : 0) +
        (draftValue.amountMax !== undefined ? 1 : 0),
    },
    {
      key: "other",
      label: "Other",
      count: draftValue.types.length + draftValue.statuses.length,
    },
  ];

  const handleApply = () => {
    onChange(draftValue);
    setOpen(false);
  };

  const handleCancel = () => {
    setDraftValue(value);
    setOpen(false);
  };

  const handleClear = () => {
    setDraftValue(defaultFilters);
  };

  const handleSectionChange = (section: FilterSection) => {
    setActiveSection(section);
    setSearchQuery("");
  };

  const handleSelectAllToggle = () => {
    if (allSelected || someSelected) {
      deselectAll();
    } else {
      selectAll();
    }
  };

  return {
    open,
    setOpen,
    draftValue,
    setDraftValue,
    activeSection,
    sections,
    handleSectionChange,
    searchQuery,
    setSearchQuery,
    allSelected,
    someSelected,
    handleSelectAllToggle,
    filteredItems,
    selectedIds,
    toggleSelection,
    showMerchantEmptyState,
    totalFiltersCount,
    appliedFiltersCount,
    handleClear,
    handleCancel,
    handleApply,
  };
}
