import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFormatters } from "@/contexts/SettingsContext";

import { GoalEditModal } from "./GoalEditModal";
import { GoalContributionModal } from "./GoalContributionModal";
import { GoalTransactionLinkModal } from "./GoalTransactionLinkModal";
import { GoalTransferModal } from "./GoalTransferModal";
import { GoalDetailTabs } from "./GoalDetailTabs";
import { useGoalDetailData, useGoalDetailState } from "./detail";

export function GoalDetailModal({
  goalId,
  open,
  onClose,
}: {
  goalId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { formatCurrency } = useFormatters();

  const data = useGoalDetailData({ goalId, open });
  const state = useGoalDetailState(data);

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Goal details</DialogTitle>
        </DialogHeader>

        {data.isLoading || !data.goal ? (
          <div className="text-sm text-muted-foreground" role="status" aria-live="polite">Loading goal...</div>
        ) : (
          <GoalDetailTabs
            goal={data.goal}
            goalId={goalId}
            formatCurrency={formatCurrency}
            onEdit={() => state.setEditOpen(true)}
            onClose={onClose}
            percentComplete={data.percentComplete}
            progressAmount={data.progressAmount}
            targetAmount={data.targetAmount}
            remainingAmount={data.remainingAmount}
            usesHoldings={!!data.usesHoldings}
            scenarioDescriptions={data.scenarioDescriptions}
            scenarioKey={state.scenarioKey}
            setScenarioKey={state.setScenarioKey}
            payoffScenarios={data.payoffScenarios}
            availableScenarioKeys={data.availableScenarioKeys}
            scenarioLabels={data.scenarioLabels}
            scenarioData={state.scenarioData}
            customPayment={state.customPayment}
            setCustomPayment={state.setCustomPayment}
            customOneTime={state.customOneTime}
            setCustomOneTime={state.setCustomOneTime}
            handleCustomPayoff={state.handleCustomPayoff}
            calculatePayoff={data.calculatePayoff}
            handleRunStrategies={state.handleRunStrategies}
            canRunStrategies={data.canRunStrategies}
            debtStrategy={data.debtStrategy}
            snowballRows={state.snowballRows}
            avalancheRows={state.avalancheRows}
            contributionEnabled={data.contributionEnabled}
            hasAutoSyncAssignments={data.hasAutoSyncAssignments}
            canContribute={data.canContribute}
            setContributionModalOpen={state.setContributionModalOpen}
            canLinkTransactions={data.canLinkTransactions}
            setLinkModalOpen={state.setLinkModalOpen}
            assignments={data.assignments}
            usesContributionSource={data.usesContributionSource}
            filteredAccounts={data.filteredAccounts}
            assignmentAccountId={state.assignmentAccountId}
            setAssignmentAccountId={state.setAssignmentAccountId}
            assignmentType={state.assignmentType}
            setAssignmentType={state.setAssignmentType}
            partialAmount={state.partialAmount}
            setPartialAmount={state.setPartialAmount}
            disableFullBalanceAssignment={data.disableFullBalanceAssignment}
            handleAssign={state.handleAssign}
            canAssign={state.canAssign}
            isAssigning={data.assignAccount.isPending}
            transfers={data.transfers}
            setTransferOpen={state.setTransferOpen}
            transferDisabled={data.transferDisabled}
            transferDisabledReason={data.transferDisabledReason}
            activity={data.activity}
            goalTransactions={data.goalTransactions}
            unlinkTransaction={data.unlinkTransaction}
            linkDisabledReason={data.linkDisabledReason}
            contributions={data.contributions}
            paymentsLoading={data.paymentsLoading}
            debtAccountId={data.debtAccountId}
            paymentTransactions={data.paymentTransactions}
          />
        )}
      </DialogContent>

      <GoalTransferModal
        open={state.transferOpen}
        onClose={() => state.setTransferOpen(false)}
        sourceGoal={data.goal ?? undefined}
      />

      <GoalEditModal
        goal={data.goal ?? null}
        open={state.editOpen}
        onClose={() => state.setEditOpen(false)}
      />

      <GoalTransactionLinkModal
        open={state.linkModalOpen}
        onClose={() => state.setLinkModalOpen(false)}
        goal={data.goal ?? null}
        linkedIds={data.linkedTransactionIds}
      />

      {data.goal && (
        <GoalContributionModal
          goal={data.goal}
          open={state.contributionModalOpen}
          onClose={() => state.setContributionModalOpen(false)}
        />
      )}
    </Dialog>
  );
}
