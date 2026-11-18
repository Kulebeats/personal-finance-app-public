/**
 * Merchant Detail View
 *
 * Main dialog component for viewing merchant details.
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Keyboard } from "lucide-react";
import type { Merchant } from "@/hooks/use-settings";
import { MerchantAvatar } from "@/components/merchants/MerchantAvatar";
import {
  MerchantDetailChart,
  MerchantCategoryBreakdown,
  MerchantAliasSection,
  MerchantTransactionsList,
  MerchantStatsCards,
  MerchantDetailFilters,
} from "./detail";
import { useMerchantDetailState } from "./detail/useMerchantDetailState";

interface MerchantDetailViewProps {
  merchantId: string | null;
  onClose: () => void;
  onEdit?: (merchant: Merchant) => void;
}

export function MerchantDetailView({
  merchantId,
  onClose,
  onEdit,
}: MerchantDetailViewProps) {
  const [, setLocation] = useLocation();
  const merchantDetailState = useMerchantDetailState(merchantId);
  const { state, data, mutations, actions } = merchantDetailState;

  // Keyboard shortcuts
  useEffect(() => {
    if (!merchantId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key === "e" && data.merchant && onEdit) {
        event.preventDefault();
        onEdit(data.merchant);
        onClose();
      } else if (event.key === "d" && data.merchant && !mutations.deleteMerchant.isPending) {
        event.preventDefault();
        actions.handleDeleteMerchant(onClose);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [merchantId, data.merchant, onEdit, onClose, actions, mutations.deleteMerchant.isPending]);

  return (
    <Dialog open={!!merchantId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{data.merchant?.name || "Merchant Details"}</DialogTitle>
          <DialogDescription>
            Review spending trends, aliases, filters, and recent transactions
            for this merchant.
          </DialogDescription>
        </DialogHeader>

        {/* Header with Avatar and Actions */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <MerchantAvatar
              name={data.merchant?.name || "Merchant"}
              logoUrl={data.merchant?.logoUrl}
              category={data.merchant?.category}
              size="lg"
            />
            <div>
              <p className="text-sm text-muted-foreground">Category</p>
              <p className="font-medium">
                {data.merchant?.category || "Uncategorized"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!data.merchant || !onEdit) return;
                    onEdit(data.merchant);
                    onClose();
                  }}
                  disabled={!data.merchant || !onEdit}
                >
                  Edit
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-2">
                <Keyboard className="h-3 w-3" aria-hidden="true" />
                <span>Keyboard shortcut: <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">E</kbd></span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => actions.handleDeleteMerchant(onClose)}
                  disabled={!data.merchant || mutations.deleteMerchant.isPending}
                >
                  Delete
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-2">
                <Keyboard className="h-3 w-3" aria-hidden="true" />
                <span>Keyboard shortcut: <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">D</kbd></span>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Stats Cards and Quick Ranges */}
        <MerchantStatsCards
          analytics={data.analytics}
          last30={data.last30}
          last90={data.last90}
          last365={data.last365}
          onQuickRange={actions.applyQuickRange}
        />

        {/* Filters */}
        <MerchantDetailFilters
          startDate={state.startDate}
          endDate={state.endDate}
          groupBy={state.groupBy}
          categoryId={state.transactionCategoryId}
          minAmount={state.transactionMinAmount}
          maxAmount={state.transactionMaxAmount}
          categories={data.categoryOptions}
          onStartDateChange={actions.setStartDate}
          onEndDateChange={actions.setEndDate}
          onGroupByChange={actions.setGroupBy}
          onCategoryChange={actions.setTransactionCategoryId}
          onMinAmountChange={actions.setTransactionMinAmount}
          onMaxAmountChange={actions.setTransactionMaxAmount}
        />

        {/* Trend Chart */}
        <div className="mt-4 h-[220px] rounded border">
          <MerchantDetailChart trend={data.analytics?.trend || []} />
        </div>

        {/* Category Breakdown */}
        <MerchantCategoryBreakdown items={data.breakdownItems} />

        {/* Aliases Section */}
        <MerchantAliasSection
          aliases={data.aliases}
          onAddAlias={(aliasName) => {
            if (merchantId) {
              mutations.addAlias.mutate({ merchantId, aliasName });
            }
          }}
          onDeleteAlias={(aliasId) => {
            if (merchantId) {
              mutations.deleteAlias.mutate({ merchantId, aliasId });
            }
          }}
          isAddPending={mutations.addAlias.isPending}
          isDeletePending={mutations.deleteAlias.isPending}
        />

        {/* Transactions List */}
        <MerchantTransactionsList
          transactions={data.formattedTransactions}
          page={state.page}
          onPageChange={actions.setPage}
          onExport={actions.handleExport}
          onViewAll={() => setLocation("/transactions")}
        />
      </DialogContent>
    </Dialog>
  );
}
