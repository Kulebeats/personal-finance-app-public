import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MerchantAvatar } from "@/components/merchants/MerchantAvatar";
import type { FilterItem, FilterSection } from "./filtersTypes";

type FiltersSelectionPanelProps = {
  activeSection: FilterSection;
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
};

export function FiltersSelectionPanel({
  activeSection,
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
}: FiltersSelectionPanelProps) {
  return (
    <>
      <div className="p-4 border-b space-y-3">
        <Input
          placeholder={`Search ${activeSection}...`}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="select-all"
            checked={allSelected}
            ref={(element) => {
              if (element) {
                (
                  element as HTMLButtonElement & { indeterminate: boolean }
                ).indeterminate = someSelected;
              }
            }}
            onCheckedChange={onSelectAllToggle}
          />
          <label
            htmlFor="select-all"
            className="text-sm font-medium cursor-pointer"
          >
            Select all
          </label>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                {showMerchantEmptyState
                  ? "No merchants yet. Add one in settings to filter by merchant."
                  : `No ${activeSection} found`}
              </p>
              {showMerchantEmptyState && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onNavigateMerchants}
                >
                  Go to Merchants Settings
                </Button>
              )}
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted cursor-pointer"
                onClick={() => toggleSelection(item.id)}
              >
                <Checkbox
                  checked={selectedIds.includes(item.id)}
                  onCheckedChange={() => toggleSelection(item.id)}
                />
                {activeSection === "merchants" ? (
                  <MerchantAvatar
                    name={item.name}
                    logoUrl={item.imageUrl}
                    category={item.category}
                    size="sm"
                  />
                ) : item.icon ? (
                  <span>{item.icon}</span>
                ) : null}
                {item.color && (
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                <span className="text-sm">{item.name}</span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </>
  );
}
