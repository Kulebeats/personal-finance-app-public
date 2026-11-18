import { Button } from "@/components/ui/button";
import type { MoneyDto } from "@/lib/api";
import { toMoneyNumber } from "@/lib/money";

import type { LinkDraft, LinkType } from "./GoalTransactionLinkTypes";
import { GoalTransactionLinkRow } from "./GoalTransactionLinkRow";

export type GoalLinkTransaction = {
  id: string;
  name: string;
  date?: string | null;
  amount: MoneyDto;
  type: string;
  currency?: string | null;
};

type GoalTransactionLinkListProps = {
  transactions: GoalLinkTransaction[];
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  drafts: Record<string, LinkDraft>;
  updateDraft: (id: string, patch: Partial<LinkDraft>) => void;
  getDefaultLinkType: (type: string) => LinkType;
  allowSpending: boolean;
  canLink: (transactionType: string, linkType: LinkType) => boolean;
  formatDate: (value?: string | null) => string;
  formatCurrency: (value: number) => string;
  onLinkTransaction: (
    transaction: GoalLinkTransaction,
    linkType: LinkType,
    amountValue: string
  ) => void;
  onBulkLink: () => void;
  isBulkLinking: boolean;
  isLinking: boolean;
};

export function GoalTransactionLinkList({
  transactions,
  selectedIds,
  onToggleSelected,
  drafts,
  updateDraft,
  getDefaultLinkType,
  allowSpending,
  canLink,
  formatDate,
  formatCurrency,
  onLinkTransaction,
  onBulkLink,
  isBulkLinking,
  isLinking,
}: GoalTransactionLinkListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          {selectedIds.size} selected
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={onBulkLink}
          disabled={isBulkLinking || selectedIds.size === 0}
        >
          {isBulkLinking ? "Linking..." : "Link selected"}
        </Button>
      </div>
      <div className="space-y-3 max-h-[360px] overflow-y-auto">
        {transactions.map((transaction) => {
          const transactionAmount = Math.abs(toMoneyNumber(transaction.amount));
          const draft = drafts[transaction.id] ?? {
            linkType: getDefaultLinkType(transaction.type),
            amount: "",
          };
          const isAllowed = canLink(transaction.type, draft.linkType);
          const amountValue = draft.amount || transactionAmount.toFixed(2);

          return (
            <GoalTransactionLinkRow
              key={transaction.id}
              transaction={transaction}
              selected={selectedIds.has(transaction.id)}
              onToggleSelected={() => onToggleSelected(transaction.id)}
              draft={draft}
              onUpdateDraft={(patch) => updateDraft(transaction.id, patch)}
              allowSpending={allowSpending}
              isAllowed={isAllowed}
              amountValue={amountValue}
              formatDate={formatDate}
              formatCurrency={formatCurrency}
              onLink={(linkType, nextAmount) =>
                onLinkTransaction(transaction, linkType, nextAmount)
              }
              isPending={isBulkLinking || isLinking}
            />
          );
        })}
      </div>
    </div>
  );
}
