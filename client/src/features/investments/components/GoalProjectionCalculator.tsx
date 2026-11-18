import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useFormat } from "@/hooks/use-format";
import { apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Calculator } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type ProjectionResult = {
  projectedAmount: number;
  totalContributed: number;
  requiredMonthlyContribution: number | null;
};

export function GoalProjectionCalculator() {
  const { formatCurrency } = useFormat();

  const [currentAmount, setCurrentAmount] = useState<number>(0);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(1000);
  const [returnRate, setReturnRate] = useState<number>(12); // Default 12%
  const [inflationRate, setInflationRate] = useState<number>(5);
  const [years, setYears] = useState<number>(5);
  const [targetAmount, setTargetAmount] = useState<number>(0);

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/goals/calculate-projection", {
        currentAmount,
        monthlyContribution,
        returnRate,
        inflationRate,
        years,
        targetAmount: targetAmount > 0 ? targetAmount : undefined,
      });
      return (await res.json()) as { data: ProjectionResult };
    },
  });

  const handleCalculate = () => {
    calculateMutation.mutate();
  };

  const result = calculateMutation.data?.data;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" /> Investment Projection
        </CardTitle>
        <CardDescription>
          Estimate future value or calculate required contributions.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Current Savings</Label>
            <Input
              type="number"
              value={currentAmount}
              onChange={(e) => setCurrentAmount(Number(e.target.value))}
              min={0}
            />
          </div>

          <div className="grid gap-2">
            <Label>Monthly Contribution</Label>
            <Input
              type="number"
              value={monthlyContribution}
              onChange={(e) => setMonthlyContribution(Number(e.target.value))}
              min={0}
            />
          </div>

          <div className="grid gap-2">
            <Label>Expected Annual Return (%)</Label>
            <div className="flex items-center gap-4">
              <Slider
                value={[returnRate]}
                onValueChange={(vals) => setReturnRate(vals[0])}
                max={30}
                step={0.5}
                className="flex-1"
              />
              <span className="w-12 text-right">{returnRate}%</span>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Inflation Rate (%)</Label>
            <div className="flex items-center gap-4">
              <Slider
                value={[inflationRate]}
                onValueChange={(vals) => setInflationRate(vals[0])}
                max={30}
                step={0.5}
                className="flex-1"
              />
              <span className="w-12 text-right">{inflationRate}%</span>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Time Horizon (Years)</Label>
            <Input
              type="number"
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
              min={1}
              max={50}
            />
          </div>

          <Button
            onClick={handleCalculate}
            disabled={calculateMutation.isPending}
            className="w-full"
          >
            {calculateMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Calculate Projection
          </Button>
        </div>

        <div className="flex flex-col justify-center space-y-6 bg-muted/30 p-4 rounded-lg">
          {result ? (
            <>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Projected Value in {years} Years
                </p>
                <p className="text-3xl font-bold text-primary">
                  {formatCurrency(result.projectedAmount)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Adjusted for {inflationRate}% inflation (Real Value)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Contributed</p>
                  <p className="font-medium">
                    {formatCurrency(result.totalContributed)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Investment Growth</p>
                  <p className="font-medium text-green-600">
                    {formatCurrency(
                      result.projectedAmount - result.totalContributed
                    )}
                  </p>
                </div>
              </div>

              {result.requiredMonthlyContribution !== null && (
                <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                  <p className="text-sm font-medium text-yellow-600">
                    To reach target:
                  </p>
                  <p className="text-lg font-bold">
                    {formatCurrency(result.requiredMonthlyContribution)} / month
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="text-center text-muted-foreground">
              Enter values and click calculate to see projections.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
