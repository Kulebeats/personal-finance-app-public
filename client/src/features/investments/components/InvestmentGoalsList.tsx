import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useFormat } from "@/hooks/use-format";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { GoalCreationWizard } from "@/features/goals/components/GoalCreationWizard";
import {
  calculateMoneyProgressPercent,
  toMoneyNumber,
} from "@/lib/money";

// Determine type from schema or manually
type Goal = {
  id: string;
  name: string;
  currentAmount: string | number;
  targetAmount: string | number;
  targetDate: string | null;
  status: string;
  type: string;
};

export function InvestmentGoalsList() {
  const { formatCurrency } = useFormat();
  const [showWizard, setShowWizard] = useState(false);

  const { data: goals, isLoading } = useQuery({
    queryKey: ["goals", "investment"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/goals?type=investment");
      return (await res.json()) as { data: Goal[] };
    },
  });

  const investmentGoals = goals?.data || [];

  if (isLoading) {
    return <div>Loading goals...</div>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Your Investment Goals</CardTitle>
          <CardDescription>
            Track progress towards your financial objectives.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowWizard(true)}>
          <Plus className="w-4 h-4 mr-2" /> New Goal
        </Button>
      </CardHeader>
      <CardContent>
        {investmentGoals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No investment goals found.</p>
            <p className="text-sm">
              Create one to start tracking retirement, property, or education
              funds.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {investmentGoals.map((goal) => {
              const current = toMoneyNumber(goal.currentAmount);
              const target = toMoneyNumber(goal.targetAmount);
              const percent = Math.min(
                100,
                calculateMoneyProgressPercent(
                  goal.currentAmount,
                  goal.targetAmount
                )
              );

              return (
                <div key={goal.id} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <h3 className="font-medium">{goal.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {formatCurrency(current)} / {formatCurrency(target)}
                      </span>
                      <Badge
                        variant={
                          goal.status === "on_track" ? "default" : "secondary"
                        }
                      >
                        {goal.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </div>
                  <Progress value={percent} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{percent.toFixed(1)}% Funded</span>
                    {goal.targetDate && (
                      <span>
                        Target: {new Date(goal.targetDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <GoalCreationWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        initialType="investment"
      />
    </Card>
  );
}
