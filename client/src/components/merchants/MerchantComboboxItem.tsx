import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandItem } from "@/components/ui/command";
import { MerchantAvatar } from "@/components/merchants/MerchantAvatar";
import type { Merchant } from "@/hooks/use-settings";

export interface MerchantComboboxItemProps {
  merchant: Merchant;
  isSelected: boolean;
  onSelect: (merchant: Merchant) => void;
}

export function MerchantComboboxItem({
  merchant,
  isSelected,
  onSelect,
}: MerchantComboboxItemProps) {
  return (
    <CommandItem
      key={merchant.id}
      value={merchant.name}
      onSelect={() => onSelect(merchant)}
    >
      <Check
        className={cn(
          "mr-2 h-4 w-4",
          isSelected ? "opacity-100" : "opacity-0"
        )}
      />
      <MerchantAvatar
        name={merchant.name}
        logoUrl={merchant.logoUrl}
        category={merchant.category}
        size="sm"
        className="mr-2"
      />
      <span>{merchant.name}</span>
    </CommandItem>
  );
}
