import { Button } from "@/components/ui/button";
import { Loader2, Keyboard } from "lucide-react";
import type { MerchantsSectionState } from "../hooks/useMerchantsSectionState";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type MerchantsHeaderActionsProps = {
  state: MerchantsSectionState;
};

export function MerchantsHeaderActions({
  state,
}: MerchantsHeaderActionsProps) {
  const { actions, flags, mutations } = state;

  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              onClick={actions.applyLogoPresets}
              disabled={flags.isApplyingLogoPresets || mutations.updateMerchant.isPending}
            >
              {flags.isApplyingLogoPresets ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Applying...
                </>
              ) : (
                "Apply logo presets"
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex items-center gap-2">
            <Keyboard className="h-3 w-3" aria-hidden="true" />
            <span>Keyboard shortcut: <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">Alt+L</kbd></span>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={actions.openCreate}
              className="bg-rose-500 hover:bg-rose-600"
            >
              Add Merchant
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex items-center gap-2">
            <Keyboard className="h-3 w-3" aria-hidden="true" />
            <span>Keyboard shortcut: <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">Ctrl+N</kbd></span>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
