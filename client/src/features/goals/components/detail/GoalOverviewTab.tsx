import type { Dispatch, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PayoffScenario } from "@/hooks/useGoals";

import { DebtStrategyPanel } from "../DebtStrategyPanel";
import { GoalDetailsSection } from "../GoalDetailsSection";
import { GoalProgressChart } from "../GoalProgressChart";
import type { ScenarioKey, StrategyRow } from "../GoalDetailTypes";
import type { GoalDetailData } from "./useGoalDetailData";

export interface GoalOverviewTabProps {
  goal: NonNullable<GoalDetailData["goal"]>;
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
}

export function GoalOverviewTab({
  goal,
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
}: GoalOverviewTabProps) {
  return (
    <GoalDetailsSection
      goal={goal}
      formatCurrency={formatCurrency}
      onEdit={onEdit}
      onClose={onClose}
      percentComplete={percentComplete}
      progressAmount={progressAmount}
      targetAmount={targetAmount}
      remainingAmount={remainingAmount}
      usesHoldings={!!usesHoldings}
    >
      {goal.type === "pay_down" ? (
        <div className="mt-4 space-y-4">
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Payoff scenarios</div>
                <div className="text-xs text-muted-foreground">
                  {scenarioDescriptions[scenarioKey]}
                </div>
              </div>
              <Select
                value={scenarioKey}
                onValueChange={(value) =>
                  setScenarioKey(value as ScenarioKey)
                }
                disabled={payoffScenarios.isLoading}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select scenario" />
                </SelectTrigger>
                <SelectContent>
                  {availableScenarioKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {scenarioLabels[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {payoffScenarios.isLoading ? (
              <div className="text-sm text-muted-foreground">
                Loading payoff scenarios...
              </div>
            ) : (
              <GoalProgressChart
                scenarioData={scenarioData}
                scenarioKey={scenarioKey}
                formatCurrency={formatCurrency}
              />
            )}

            <div className="border-t pt-3 space-y-2">
              <div className="text-sm font-medium">Custom payoff</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="custom-monthly">Monthly payment</Label>
                  <Input
                    id="custom-monthly"
                    type="number"
                    inputMode="decimal"
                    value={customPayment}
                    onChange={(event) =>
                      setCustomPayment(event.target.value)
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="custom-onetime">One-time payment</Label>
                  <Input
                    id="custom-onetime"
                    type="number"
                    inputMode="decimal"
                    value={customOneTime}
                    onChange={(event) =>
                      setCustomOneTime(event.target.value)
                    }
                  />
                </div>
              </div>
              <Button
                size="sm"
                onClick={handleCustomPayoff}
                disabled={calculatePayoff.isPending}
              >
                Calculate
              </Button>
              {calculatePayoff.data ? (
                <div className="text-xs text-muted-foreground">
                  Payoff date: {calculatePayoff.data.payoffDate ?? "N/A"} |{" "}
                  Interest: {formatCurrency(calculatePayoff.data.totalInterest)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">
                  Debt strategy comparison
                </div>
                <div className="text-xs text-muted-foreground">
                  Uses your current pay down goals.
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRunStrategies}
                disabled={!canRunStrategies || debtStrategy.isPending}
              >
                {debtStrategy.isPending ? "Running..." : "Run strategies"}
              </Button>
            </div>
            {!canRunStrategies ? (
              <p className="text-xs text-muted-foreground">
                Add at least two pay down goals to compare snowball and
                avalanche.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <DebtStrategyPanel
                  title="Snowball"
                  rows={snowballRows}
                  formatCurrency={formatCurrency}
                />
                <DebtStrategyPanel
                  title="Avalanche"
                  rows={avalancheRows}
                  formatCurrency={formatCurrency}
                />
              </div>
            )}
          </div>
        </div>
      ) : null}

      {contributionEnabled ? (
        <div className="border rounded-lg p-4 space-y-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Add contribution</div>
            {hasAutoSyncAssignments ? (
              <p className="text-xs text-muted-foreground">
                Contributions are disabled for goals with auto-synced
                accounts.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Manually add a contribution to this goal.
              </p>
            )}
          </div>
          {!hasAutoSyncAssignments && (
            <Button
              size="sm"
              onClick={() => setContributionModalOpen(true)}
              disabled={!canContribute}
            >
              Add Contribution
            </Button>
          )}
        </div>
      ) : null}
    </GoalDetailsSection>
  );
}
