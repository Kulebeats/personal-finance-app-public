import type { Dispatch, SetStateAction } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PayoffScenario } from "@/hooks/useGoals";
import type { MoneyDto } from "@/lib/api";

import type { ScenarioKey, StrategyRow } from "./GoalDetailTypes";
import {
  GoalOverviewTab,
  GoalAssignmentsTab,
  GoalTransfersTab,
  GoalActivityTab,
  GoalTransactionsTab,
} from "./detail";
import type { GoalDetailData } from "./detail/useGoalDetailData";

type GoalDetailTabsProps = {
  goal: NonNullable<GoalDetailData["goal"]>;
  goalId: string;
  formatCurrency: (value: number) => string;
  onEdit: () => void;
  onClose: () => void;
  percentComplete: number;
  progressAmount: number;
  targetAmount: number;
  remainingAmount: number;
  usesHoldings: boolean;
  scenarioDescriptions: Record<ScenarioKey, string>;
  scenarioKey: ScenarioKey;
  setScenarioKey: Dispatch<SetStateAction<ScenarioKey>>;
  payoffScenarios: GoalDetailData["payoffScenarios"];
  availableScenarioKeys: ScenarioKey[];
  scenarioLabels: Record<ScenarioKey, string>;
  scenarioData: PayoffScenario | null;
  customPayment: string;
  setCustomPayment: Dispatch<SetStateAction<string>>;
  customOneTime: string;
  setCustomOneTime: Dispatch<SetStateAction<string>>;
  handleCustomPayoff: () => void;
  calculatePayoff: GoalDetailData["calculatePayoff"];
  handleRunStrategies: () => void;
  canRunStrategies: boolean;
  debtStrategy: GoalDetailData["debtStrategy"];
  snowballRows: StrategyRow[];
  avalancheRows: StrategyRow[];
  contributionEnabled: boolean;
  hasAutoSyncAssignments: boolean;
  canContribute: boolean;
  setContributionModalOpen: Dispatch<SetStateAction<boolean>>;
  canLinkTransactions: boolean;
  setLinkModalOpen: Dispatch<SetStateAction<boolean>>;
  assignments: GoalDetailData["assignments"];
  usesContributionSource: boolean;
  filteredAccounts: GoalDetailData["filteredAccounts"];
  assignmentAccountId: string;
  setAssignmentAccountId: Dispatch<SetStateAction<string>>;
  assignmentType: "full_balance" | "partial_balance";
  setAssignmentType: Dispatch<SetStateAction<"full_balance" | "partial_balance">>;
  partialAmount: string;
  setPartialAmount: Dispatch<SetStateAction<string>>;
  disableFullBalanceAssignment?: boolean;
  handleAssign: () => void;
  canAssign: boolean;
  isAssigning: boolean;
  transfers: GoalDetailData["transfers"];
  setTransferOpen: Dispatch<SetStateAction<boolean>>;
  transferDisabled: boolean;
  transferDisabledReason: string | null;
  activity: GoalDetailData["activity"];
  goalTransactions: GoalDetailData["goalTransactions"];
  unlinkTransaction: { mutate: (id: string) => void; isPending: boolean };
  linkDisabledReason: string | null;
  contributions: GoalDetailData["contributions"];
  paymentsLoading: boolean;
  debtAccountId: string;
  paymentTransactions: Array<{
    id: string;
    name: string;
    date: string;
    amount: MoneyDto;
  }>;
};

export function GoalDetailTabs({
  goal,
  goalId,
  formatCurrency,
  onEdit,
  onClose,
  percentComplete,
  progressAmount,
  targetAmount,
  remainingAmount,
  usesHoldings,
  scenarioDescriptions,
  scenarioKey,
  setScenarioKey,
  payoffScenarios,
  availableScenarioKeys,
  scenarioLabels,
  scenarioData,
  customPayment,
  setCustomPayment,
  customOneTime,
  setCustomOneTime,
  handleCustomPayoff,
  calculatePayoff,
  handleRunStrategies,
  canRunStrategies,
  debtStrategy,
  snowballRows,
  avalancheRows,
  contributionEnabled,
  hasAutoSyncAssignments,
  canContribute,
  setContributionModalOpen,
  canLinkTransactions,
  setLinkModalOpen,
  assignments,
  usesContributionSource,
  filteredAccounts,
  assignmentAccountId,
  setAssignmentAccountId,
  assignmentType,
  setAssignmentType,
  partialAmount,
  setPartialAmount,
  disableFullBalanceAssignment,
  handleAssign,
  canAssign,
  isAssigning,
  transfers,
  setTransferOpen,
  transferDisabled,
  transferDisabledReason,
  activity,
  goalTransactions,
  unlinkTransaction,
  linkDisabledReason,
  contributions,
  paymentsLoading,
  debtAccountId,
  paymentTransactions,
}: GoalDetailTabsProps) {
  return (
    <Tabs defaultValue="overview">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="assignments">Assignments</TabsTrigger>
        <TabsTrigger value="transfers">Transfers</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="transactions">
          {goal.type === "pay_down" ? "Payments" : "Transactions"}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-6">
        <GoalOverviewTab
          goal={goal}
          formatCurrency={formatCurrency}
          onEdit={onEdit}
          onClose={onClose}
          percentComplete={percentComplete}
          progressAmount={progressAmount}
          targetAmount={targetAmount}
          remainingAmount={remainingAmount}
          usesHoldings={!!usesHoldings}
          scenarioDescriptions={scenarioDescriptions}
          scenarioKey={scenarioKey}
          setScenarioKey={setScenarioKey}
          payoffScenarios={payoffScenarios}
          availableScenarioKeys={availableScenarioKeys}
          scenarioLabels={scenarioLabels}
          scenarioData={scenarioData}
          customPayment={customPayment}
          setCustomPayment={setCustomPayment}
          customOneTime={customOneTime}
          setCustomOneTime={setCustomOneTime}
          handleCustomPayoff={handleCustomPayoff}
          calculatePayoff={calculatePayoff}
          handleRunStrategies={handleRunStrategies}
          canRunStrategies={canRunStrategies}
          debtStrategy={debtStrategy}
          snowballRows={snowballRows}
          avalancheRows={avalancheRows}
          contributionEnabled={contributionEnabled}
          hasAutoSyncAssignments={hasAutoSyncAssignments}
          canContribute={canContribute}
          setContributionModalOpen={setContributionModalOpen}
        />
      </TabsContent>

      <TabsContent value="assignments" className="mt-6">
        <GoalAssignmentsTab
          goal={goal}
          goalId={goalId}
          formatCurrency={formatCurrency}
          usesHoldings={!!usesHoldings}
          assignments={assignments}
          filteredAccounts={filteredAccounts}
          assignmentAccountId={assignmentAccountId}
          setAssignmentAccountId={setAssignmentAccountId}
          assignmentType={assignmentType}
          setAssignmentType={setAssignmentType}
          partialAmount={partialAmount}
          setPartialAmount={setPartialAmount}
          disableFullBalanceAssignment={disableFullBalanceAssignment}
          handleAssign={handleAssign}
          canAssign={canAssign}
          isAssigning={isAssigning}
        />
      </TabsContent>

      <TabsContent value="transfers" className="mt-6">
        <GoalTransfersTab
          goalId={goalId}
          formatCurrency={formatCurrency}
          transfers={transfers}
          setTransferOpen={setTransferOpen}
          transferDisabled={transferDisabled}
          transferDisabledReason={transferDisabledReason}
        />
      </TabsContent>

      <TabsContent value="activity" className="mt-6">
        <GoalActivityTab activity={activity} />
      </TabsContent>

      <TabsContent value="transactions" className="mt-6">
        <GoalTransactionsTab
          goal={goal}
          formatCurrency={formatCurrency}
          canContribute={canContribute}
          canLinkTransactions={canLinkTransactions}
          setContributionModalOpen={setContributionModalOpen}
          setLinkModalOpen={setLinkModalOpen}
          linkDisabledReason={linkDisabledReason}
          goalTransactions={goalTransactions}
          unlinkTransaction={unlinkTransaction}
          contributions={contributions}
          usesContributionSource={usesContributionSource}
          paymentsLoading={paymentsLoading}
          debtAccountId={debtAccountId}
          paymentTransactions={paymentTransactions}
        />
      </TabsContent>
    </Tabs>
  );
}
