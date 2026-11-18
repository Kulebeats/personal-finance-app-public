import type { Dispatch, SetStateAction } from "react";

import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TransactionFilters, FilterItem, FilterSection } from "./filtersTypes";
import { FiltersSectionNav } from "./FiltersSectionNav";
import { FiltersSelectionPanel } from "./FiltersSelectionPanel";
import { FiltersAmountPanel } from "./FiltersAmountPanel";
import { FiltersOtherPanel } from "./FiltersOtherPanel";
import { FiltersSummaryPanel } from "./FiltersSummaryPanel";
import { FiltersFooter } from "./FiltersFooter";

type FiltersModalContentProps = {
  activeSection: FilterSection;
  sections: { key: FilterSection; label: string; count: number }[];
  onSectionChange: (section: FilterSection) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAllToggle: () => void;
  filteredItems: FilterItem[];
  selectedIds: string[];
  toggleSelection: (id: string) => void;
  showMerchantEmptyState: boolean;
  onNavigateMerchants: () => void;
  draftValue: TransactionFilters;
  setDraftValue: Dispatch<SetStateAction<TransactionFilters>>;
  totalFiltersCount: number;
  onClear: () => void;
  onCancel: () => void;
  onApply: () => void;
};

export function FiltersModalContent({
  activeSection,
  sections,
  onSectionChange,
  searchQuery,
  onSearchQueryChange,
  allSelected,
  someSelected,
  onSelectAllToggle,
  filteredItems,
  selectedIds,
  toggleSelection,
  showMerchantEmptyState,
  onNavigateMerchants,
  draftValue,
  setDraftValue,
  totalFiltersCount,
  onClear,
  onCancel,
  onApply,
}: FiltersModalContentProps) {
  return (
    <>
      <DialogHeader className="px-6 py-4 border-b">
        <DialogTitle>Filters</DialogTitle>
        <DialogDescription>
          Select filters to narrow down your transactions.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-1 overflow-hidden">
        <FiltersSectionNav
          sections={sections}
          activeSection={activeSection}
          onSectionChange={onSectionChange}
        />

        <div className="flex-1 flex flex-col">
          {activeSection !== "amount" && activeSection !== "other" ? (
            <FiltersSelectionPanel
              activeSection={activeSection}
              searchQuery={searchQuery}
              onSearchQueryChange={onSearchQueryChange}
              allSelected={allSelected}
              someSelected={someSelected}
              onSelectAllToggle={onSelectAllToggle}
              filteredItems={filteredItems}
              selectedIds={selectedIds}
              toggleSelection={toggleSelection}
              showMerchantEmptyState={showMerchantEmptyState}
              onNavigateMerchants={onNavigateMerchants}
            />
          ) : activeSection === "amount" ? (
            <FiltersAmountPanel
              draftValue={draftValue}
              setDraftValue={setDraftValue}
            />
          ) : (
            <FiltersOtherPanel
              draftValue={draftValue}
              setDraftValue={setDraftValue}
            />
          )}
        </div>

        <FiltersSummaryPanel
          draftValue={draftValue}
          totalFiltersCount={totalFiltersCount}
        />
      </div>

      <FiltersFooter
        totalFiltersCount={totalFiltersCount}
        onClear={onClear}
        onCancel={onCancel}
        onApply={onApply}
      />
    </>
  );
}
