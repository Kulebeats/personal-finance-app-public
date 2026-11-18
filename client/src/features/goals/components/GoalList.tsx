import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target, CreditCard } from "lucide-react";
import { GoalListItem } from "./GoalListItem";
import { AvailableFundsDashboard } from "./AvailableFundsDashboard";
import { type Goal, useGoalsSummary } from "@/hooks/useGoals";
import { useFormatters } from "@/contexts/SettingsContext";
import { useGoalsData } from "../hooks/useGoalsData";
import { parseMoney } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";

interface GoalListProps {
  onGoalClick: (id: string) => void;
  onNewGoal: () => void;
  onOpenTransfer: () => void;
  onOpenAccounts: () => void;
}

export function GoalList({
  onGoalClick,
  onNewGoal,
  onOpenTransfer,
  onOpenAccounts,
}: GoalListProps) {
  const { saveUpGoals, payDownGoals, summary, isSummaryLoading } =
    useGoalsData();
  const { formatCurrency } = useFormatters();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div>
        <Tabs defaultValue="save_up" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-muted/50 border border-border/50">
            <TabsTrigger value="save_up">Save Up</TabsTrigger>
            <TabsTrigger value="pay_down">Pay Down</TabsTrigger>
          </TabsList>

          <TabsContent value="save_up" className="mt-6 space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-4 bg-emerald-50/50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/50">
                <div className="text-xs font-medium text-emerald-800 dark:text-emerald-400 uppercase tracking-wider mb-1">
                  Total Saved
                </div>
                <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                  {summary ? formatCurrency(summary.saveUp.totalSaved) : "..."}
                </div>
              </Card>
              <Card className="p-4 bg-blue-50/50 border-blue-100 dark:bg-blue-950/20 dark:border-blue-900/50">
                <div className="text-xs font-medium text-blue-800 dark:text-blue-400 uppercase tracking-wider mb-1">
                  Monthly Projection
                </div>
                <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                  {formatCurrency(
                    saveUpGoals.reduce(
                      (sum, g) => sum + parseMoney(g.monthlyProjection || "0"),
                      0,
                    ),
                  )}
                </div>
              </Card>
            </div>

            {saveUpGoals.length === 0 ? (
              <Card className="p-6 border-dashed">
                <EmptyState
                  icon={Target}
                  title="No goals yet"
                  description="Start saving for your dreams. Create your first goal to track your progress."
                  primaryAction={{
                    label: "Create Goal",
                    onClick: onNewGoal,
                  }}
                  testId="save-up-goals-empty-state"
                />
              </Card>
            ) : (
              <div className="space-y-4">
                {saveUpGoals.map((goal) => (
                  <GoalListItem
                    key={goal.id}
                    goal={goal}
                    onClick={() => onGoalClick(goal.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="pay_down" className="mt-6 space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-4 bg-orange-50/50 border-orange-100 dark:bg-orange-950/20 dark:border-orange-900/50">
                <div className="text-xs font-medium text-orange-800 dark:text-orange-400 uppercase tracking-wider mb-1">
                  Total Debt
                </div>
                <div className="text-2xl font-bold text-orange-900 dark:text-orange-100">
                  {summary ? formatCurrency(summary.payDown.totalDebt) : "..."}
                </div>
              </Card>
              <Card className="p-4 bg-slate-50/50 border-slate-100 dark:bg-slate-950/20 dark:border-slate-800/50">
                <div className="text-xs font-medium text-slate-800 dark:text-slate-400 uppercase tracking-wider mb-1">
                  Monthly Payments
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {formatCurrency(
                    payDownGoals.reduce(
                      (sum, g) => sum + parseMoney(g.monthlyPayment || "0"),
                      0,
                    ),
                  )}
                </div>
              </Card>
            </div>

            {payDownGoals.length === 0 ? (
              <Card className="p-6 border-dashed">
                <EmptyState
                  icon={CreditCard}
                  title="No debts to pay down"
                  description="You're debt free! Great job."
                  iconBgClassName="bg-orange-500/10"
                  iconClassName="text-orange-600"
                  testId="pay-down-goals-empty-state"
                />
              </Card>
            ) : (
              <div className="space-y-4">
                {payDownGoals.map((goal) => (
                  <GoalListItem
                    key={goal.id}
                    goal={goal}
                    onClick={() => onGoalClick(goal.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <aside className="space-y-4">
        <AvailableFundsDashboard />
        <Card className="p-4 space-y-2">
          <Button
            className="w-full bg-orange-500 hover:bg-orange-600"
            onClick={onOpenTransfer}
          >
            Create goal transfer
          </Button>
          <Button variant="outline" className="w-full" onClick={onOpenAccounts}>
            Goal accounts
          </Button>
        </Card>
      </aside>
    </div>
  );
}
