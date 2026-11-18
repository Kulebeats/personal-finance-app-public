import { useLocation } from "wouter";
import { Filter } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FiltersModalContent } from "@/components/transactions/FiltersModalContent";
import { useFiltersModalState } from "@/components/transactions/useFiltersModalState";
import { defaultFilters, type TransactionFilters } from "./filtersTypes";

export { defaultFilters };
export type { TransactionFilters };

interface FiltersModalProps {
  value: TransactionFilters;
  onChange: (value: TransactionFilters) => void;
  className?: string;
}

export function FiltersModal({ value, onChange, className }: FiltersModalProps) {
  const [, setLocation] = useLocation();
  const {
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
  } = useFiltersModalState({ value, onChange });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-2",
            appliedFiltersCount > 0 && "border-orange-500 text-orange-600",
            className
          )}
        >
          <Filter className="h-4 w-4" />
          Filters
          {appliedFiltersCount > 0 && (
            <span className="ml-1 rounded-full bg-orange-100 px-1.5 py-0.5 text-xs text-orange-600">
              {appliedFiltersCount}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl h-[600px] p-0 gap-0">
        <FiltersModalContent
          activeSection={activeSection}
          sections={sections}
          onSectionChange={handleSectionChange}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          allSelected={allSelected}
          someSelected={someSelected}
          onSelectAllToggle={handleSelectAllToggle}
          filteredItems={filteredItems}
          selectedIds={selectedIds}
          toggleSelection={toggleSelection}
          showMerchantEmptyState={showMerchantEmptyState}
          onNavigateMerchants={() => setLocation("/settings/merchants")}
          draftValue={draftValue}
          setDraftValue={setDraftValue}
          totalFiltersCount={totalFiltersCount}
          onClear={handleClear}
          onCancel={handleCancel}
          onApply={handleApply}
        />
      </DialogContent>
    </Dialog>
  );
}
