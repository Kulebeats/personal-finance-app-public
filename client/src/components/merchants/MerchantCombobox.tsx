import { Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandList,
  CommandInput,
} from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";
import { CommandItem } from "@/components/ui/command";
import type { Merchant } from "@/hooks/use-settings";
import { MerchantComboboxItem } from "./MerchantComboboxItem";
import { useMerchantCombobox } from "./useMerchantCombobox";

export interface MerchantComboboxProps {
  value: string;
  selectedMerchantId: string;
  onInputChange: (value: string) => void;
  onSelect: (merchant: Merchant) => void;
  onCreate: (name: string) => Promise<Merchant | null>;
  onClear: () => void;
  isCreatePending?: boolean;
  placeholder?: string;
  disabled?: boolean;
  recentLimit?: number;
}

export function MerchantCombobox({
  value,
  selectedMerchantId,
  onInputChange,
  onSelect,
  onCreate,
  onClear,
  isCreatePending,
  placeholder = "Select merchant",
  disabled = false,
  recentLimit = 8,
}: MerchantComboboxProps) {
  const combobox = useMerchantCombobox({ value, selectedMerchantId, recentLimit });

  const handleSearchChange = (nextValue: string) => {
    combobox.setSearchValue(nextValue);
    onInputChange(nextValue);
  };

  const handleMerchantSelect = (merchant: Merchant) => {
    onSelect(merchant);
    combobox.setSearchValue(merchant.name);
    combobox.setOpen(false);
  };

  const handleClear = () => {
    onClear();
    combobox.setSearchValue("");
  };

  const handleCreateMerchant = async () => {
    const name = combobox.cleanMerchantName(combobox.cleanedSearch);
    if (!name || isCreatePending) return;
    if (combobox.matchingMerchant) {
      handleMerchantSelect(combobox.matchingMerchant);
      return;
    }
    const created = await onCreate(name);
    if (created) {
      handleMerchantSelect(created);
    }
  };

  const displayName = combobox.selectedMerchant?.name || value || placeholder;

  return (
    <Popover open={combobox.open} onOpenChange={combobox.setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          type="button"
          className={cn("w-full justify-between", !value && "text-muted-foreground")}
          disabled={disabled}
        >
          {displayName}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput
            placeholder={
              combobox.merchantsLoading ? "Loading merchants..." : "Search merchants..."
            }
            value={combobox.searchValue}
            onValueChange={handleSearchChange}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                combobox.setOpen(false);
              }
            }}
          />
          {combobox.hasExactMerchantMatch && combobox.cleanedSearch.length > 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Merchant already exists. Select it from the list below.
            </div>
          )}
          {combobox.showSimilarWarning && combobox.bestSimilarMerchant && (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center justify-between gap-2">
              <span>Did you mean "{combobox.bestSimilarMerchant.merchant.name}"?</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleMerchantSelect(combobox.bestSimilarMerchant!.merchant)}
              >
                Use
              </Button>
            </div>
          )}
          <CommandList>
            <CommandEmpty>
              {combobox.merchantsLoading
                ? "Loading merchants..."
                : combobox.normalizedSearch.length > 0 && combobox.autocompleteLoading
                ? "Searching merchants..."
                : combobox.filteredMerchants?.length
                ? "No merchants found."
                : "No merchants yet. Start typing to create one."}
            </CommandEmpty>
            {(value || selectedMerchantId) && combobox.normalizedSearch.length === 0 && (
              <CommandGroup heading="Selection">
                <CommandItem onSelect={handleClear}>
                  <X className="mr-2 h-4 w-4" />
                  Clear selection
                </CommandItem>
              </CommandGroup>
            )}
            {combobox.showRecentMerchants && (
              <CommandGroup heading="Recent">
                {combobox.recentMerchants.map((merchant) => (
                  <MerchantComboboxItem
                    key={merchant.id}
                    merchant={merchant}
                    isSelected={selectedMerchantId === merchant.id}
                    onSelect={handleMerchantSelect}
                  />
                ))}
              </CommandGroup>
            )}
            <CommandGroup
              heading={combobox.normalizedSearch.length > 0 ? "Results" : "All merchants"}
            >
              {combobox.remainingMerchants.map((merchant) => (
                <MerchantComboboxItem
                  key={merchant.id}
                  merchant={merchant}
                  isSelected={selectedMerchantId === merchant.id}
                  onSelect={handleMerchantSelect}
                />
              ))}
            </CommandGroup>
            {!combobox.hasExactMerchantMatch && combobox.cleanedSearch.length > 0 && (
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    void handleCreateMerchant();
                  }}
                  disabled={isCreatePending}
                >
                  {isCreatePending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Create "{combobox.cleanedSearch}"
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
