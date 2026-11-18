import type { Dispatch, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import type { MoneyDto } from "@/lib/api";
import {
  ContributionHistoryList,
  PaymentHistoryList,
  TransactionsList,
} from "../GoalHistoryList";
import type { GoalDetailData } from "./useGoalDetailData";

export interface GoalTransactionsTabProps {
  goal: { type: string };
  formatCurrency: (value: number) => string;
  canContribute: boolean;
  canLinkTransactions: boolean;
  setContributionModalOpen: Dispatch<SetStateAction<boolean>>;
  setLinkModalOpen: Dispatch<SetStateAction<boolean>>;
  linkDisabledReason: string | null;
  goalTransactions: GoalDetailData["goalTransactions"];
  unlinkTransaction: { mutate: (id: string) => void; isPending: boolean };
  contributions: GoalDetailData["contributions"];
  usesContributionSource: boolean;
  paymentsLoading: boolean;
  debtAccountId: string;
  paymentTransactions: Array<{
    id: string;
    name: string;
    date: string;
    amount: MoneyDto;
  }>;
}

export function GoalTransactionsTab({
  goal,
  formatCurrency,
  canContribute,
  canLinkTransactions,
  setContributionModalOpen,
  setLinkModalOpen,
  linkDisabledReason,
  goalTransactions,
  unlinkTransaction,
  contributions,
  usesContributionSource,
  paymentsLoading,
  debtAccountId,
  paymentTransactions,
}: GoalTransactionsTabProps) {
  if (goal.type === "save_up") {
    return (
      <>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">Linked transactions</h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => setContributionModalOpen(true)}
              disabled={!canContribute}
            >
              Add Contribution
            </Button>
            <Button
              size="sm"
              onClick={() => setLinkModalOpen(true)}
              disabled={!canLinkTransactions}
            >
              Link transaction
            </Button>
          </div>
        </div>
        {linkDisabledReason ? (
          <p className="text-xs text-muted-foreground mb-3">
            {linkDisabledReason}
          </p>
        ) : null}
        <TransactionsList
          items={goalTransactions}
          formatCurrency={formatCurrency}
          onUnlink={(transactionId) => unlinkTransaction.mutate(transactionId)}
          unlinking={unlinkTransaction.isPending}
        />
      </>
    );
  }

  if (goal.type === "investment") {
    return (
      <>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">Contribution history</h3>
        </div>
        <ContributionHistoryList
          items={contributions}
          formatCurrency={formatCurrency}
        />

        {usesContributionSource ? (
          <>
            <div className="flex items-center justify-between mt-6 mb-4">
              <h3 className="text-sm font-medium">Linked transactions</h3>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setContributionModalOpen(true)}
                  disabled={!canContribute}
                >
                  Add Contribution
                </Button>
                <Button
                  size="sm"
                  onClick={() => setLinkModalOpen(true)}
                  disabled={!canLinkTransactions}
                >
                  Link transaction
                </Button>
              </div>
            </div>
            {linkDisabledReason ? (
              <p className="text-xs text-muted-foreground mb-3">
                {linkDisabledReason}
              </p>
            ) : null}
            <TransactionsList
              items={goalTransactions}
              formatCurrency={formatCurrency}
              onUnlink={(transactionId) =>
                unlinkTransaction.mutate(transactionId)
              }
              unlinking={unlinkTransaction.isPending}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground mt-4">
            Linked transactions are disabled for holdings-synced investment
            goals.
          </p>
        )}
      </>
    );
  }

  // pay_down type
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Payment history</h3>
      </div>
      {paymentsLoading ? (
        <p className="text-sm text-muted-foreground">Loading payments...</p>
      ) : debtAccountId ? (
        <PaymentHistoryList
          items={paymentTransactions}
          formatCurrency={formatCurrency}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No debt account assigned.
        </p>
      )}
    </>
  );
}
