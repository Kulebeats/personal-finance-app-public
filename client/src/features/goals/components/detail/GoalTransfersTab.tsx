import type { Dispatch, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { TransfersList } from "../GoalHistoryList";
import type { GoalDetailData } from "./useGoalDetailData";

export interface GoalTransfersTabProps {
  goalId: string;
  formatCurrency: (value: number) => string;
  transfers: GoalDetailData["transfers"];
  setTransferOpen: Dispatch<SetStateAction<boolean>>;
  transferDisabled: boolean;
  transferDisabledReason: string | null;
}

export function GoalTransfersTab({
  goalId,
  formatCurrency,
  transfers,
  setTransferOpen,
  transferDisabled,
  transferDisabledReason,
}: GoalTransfersTabProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Transfers</h3>
        <Button
          size="sm"
          onClick={() => setTransferOpen(true)}
          disabled={transferDisabled}
        >
          New transfer
        </Button>
      </div>
      {transferDisabledReason ? (
        <p className="text-xs text-muted-foreground mb-3">
          {transferDisabledReason}
        </p>
      ) : null}
      <TransfersList
        transfers={transfers}
        goalId={goalId}
        formatCurrency={formatCurrency}
      />
    </>
  );
}
