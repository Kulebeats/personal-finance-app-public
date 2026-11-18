import { Button } from "@/components/ui/button";
import { MerchantAvatar } from "@/components/merchants/MerchantAvatar";
import { Loader2, Edit2, Merge, MoreHorizontal, Store } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";
import type { KeyboardEvent } from "react";
import type { Merchant } from "@/hooks/use-settings";

type MerchantsListPanelProps = {
  readonly state: MerchantsSectionState;
};

export function MerchantsListPanel({ state }: MerchantsListPanelProps) {
  const { derived, state: viewState, flags, actions, mutations } = state;

  const handleKeyDown = (
    e: KeyboardEvent<HTMLDivElement | HTMLLIElement>,
    merchant: Merchant,
  ) => {
    // Only handle shortcuts if not typing in a checkbox or other input
    if (e.target !== e.currentTarget) return;

    switch (e.key.toLowerCase()) {
      case "enter":
        e.preventDefault();
        actions.setDetailMerchant(merchant);
        break;
      case "e":
        e.preventDefault();
        actions.openEdit(merchant);
        break;
      case "m":
        e.preventDefault();
        actions.setMergeSource(merchant.id);
        break;
    }
  };

  if (derived.filteredMerchants && derived.filteredMerchants.length > 0) {
    return (
      <TooltipProvider>
        <ul className="space-y-2">
          {derived.filteredMerchants.map((merchant) => (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
            <li
              key={merchant.id}
              className="flex items-center justify-between p-3 bg-accent/30 rounded-lg hover:bg-accent/50 focus-within:bg-accent/50 focus-within:ring-2 focus-within:ring-primary transition-colors group"
              tabIndex={0}
              onKeyDown={(e) => handleKeyDown(e, merchant)}
              aria-label={`${merchant.name} - ${merchant.transactionCount || 0} transactions. Press Enter for details, E to edit, M to merge.`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={viewState.bulkSelection[merchant.id] || false}
                  onChange={() => actions.toggleBulkSelection(merchant.id)}
                  aria-label={`Select ${merchant.name} for bulk actions`}
                />
                <MerchantAvatar
                  name={merchant.name}
                  logoUrl={merchant.logoUrl}
                  category={merchant.category}
                  size="md"
                />
                <div>
                  <p className="font-medium text-sm">{merchant.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {merchant.transactionCount || 0} transactions
                  </p>
                  {merchant.category && (
                    <p className="text-[10px] text-muted-foreground">
                      {merchant.category}
                    </p>
                  )}
                </div>
              </div>

              {/* Desktop Actions */}
              <div className="hidden md:flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => actions.setDetailMerchant(merchant)}
                      aria-label={`View ${merchant.name} details`}
                      tabIndex={-1}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>View details (Enter)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => actions.openEdit(merchant)}
                      aria-label={`Edit ${merchant.name}`}
                      tabIndex={-1}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit (E)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => actions.setMergeSource(merchant.id)}
                      aria-label={`Merge ${merchant.name} with another merchant`}
                      tabIndex={-1}
                    >
                      <Merge className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Merge (M)</TooltipContent>
                </Tooltip>
              </div>

              {/* Mobile Actions (Overflow Menu) */}
              <div className="md:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${merchant.name}`}>
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => actions.setDetailMerchant(merchant)}
                    >
                      <MoreHorizontal className="w-4 h-4 mr-2" />
                      Details
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => actions.openEdit(merchant)}
                    >
                      <Edit2 className="w-4 h-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => actions.setMergeSource(merchant.id)}
                    >
                      <Merge className="w-4 h-4 mr-2" />
                      Merge
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      </TooltipProvider>
    );
  }

  if (flags.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="text-center py-8">
      <Store className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
      <p className="text-muted-foreground mb-4">
        No merchants found. Would you like to add common Zambian merchants?
      </p>
      <Button
        onClick={() => mutations.seedMerchants.mutate()}
        disabled={mutations.seedMerchants.isPending}
        className="bg-rose-400 hover:bg-rose-500"
      >
        {mutations.seedMerchants.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Creating...
          </>
        ) : (
          "Add Zambian Merchants"
        )}
      </Button>
      <p className="text-xs text-muted-foreground mt-3">
        Includes Pick n Pay, Shoprite, Game, Puma, MTN, ZESCO, and 60+ more
      </p>
    </div>
  );
}
