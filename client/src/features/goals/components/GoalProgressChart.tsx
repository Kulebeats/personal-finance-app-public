import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PayoffScenario } from "@/hooks/useGoals";

type ScenarioKey =
  | "minimum"
  | "current"
  | "accelerated"
  | "aggressive"
  | "custom";

interface GoalProgressChartProps {
  scenarioData: PayoffScenario | null;
  scenarioKey: ScenarioKey;
  formatCurrency: (amount: number) => string;
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export function GoalProgressChart({
  scenarioData,
  scenarioKey,
  formatCurrency,
}: GoalProgressChartProps) {
  const [showFullSchedule, setShowFullSchedule] = useState(false);

  const scenarioSchedule = scenarioData?.schedule ?? [];
  const visibleSchedule = showFullSchedule
    ? scenarioSchedule
    : scenarioSchedule.slice(0, 6);

  const timelineData = useMemo(() => {
    if (scenarioSchedule.length <= 48) {
      return scenarioSchedule.map((item) => ({
        month: item.month,
        balance: item.balance,
      }));
    }

    const step = Math.max(1, Math.ceil(scenarioSchedule.length / 48));
    return scenarioSchedule
      .filter(
        (_, index) =>
          index % step === 0 || index === scenarioSchedule.length - 1
      )
      .map((item) => ({
        month: item.month,
        balance: item.balance,
      }));
  }, [scenarioSchedule]);

  if (!scenarioData) {
    if (scenarioKey === "custom") {
      return (
        <div className="text-sm text-muted-foreground">
          Run a custom payoff to see results.
        </div>
      );
    }
    return <div className="text-sm text-muted-foreground">No payoff data.</div>;
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="border rounded-lg p-3 space-y-2">
          <div>
            <div className="text-xs text-muted-foreground">Monthly payment</div>
            <div className="text-sm font-semibold">
              {formatCurrency(scenarioData.monthlyPayment)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Payoff date</div>
            <div className="text-sm font-semibold">
              {scenarioData.payoffDate
                ? formatDate(scenarioData.payoffDate)
                : "N/A"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Months to payoff
            </div>
            <div className="text-sm font-semibold">
              {scenarioData.monthsToPayoff ?? "N/A"}
            </div>
          </div>
        </div>
        <div className="border rounded-lg p-3 space-y-2">
          <div>
            <div className="text-xs text-muted-foreground">Total payment</div>
            <div className="text-sm font-semibold">
              {formatCurrency(scenarioData.totalPayment)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total interest</div>
            <div className="text-sm font-semibold">
              {formatCurrency(scenarioData.totalInterest)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Interest saved vs minimum
            </div>
            <div className="text-sm font-semibold">
              {formatCurrency(scenarioData.interestSavedVsMinimum)}
            </div>
          </div>
        </div>
      </div>

      {timelineData.length > 0 ? (
        <div className="space-y-2">
          <div className="text-sm font-medium">Payoff timeline</div>
          <div className="h-40 w-full rounded-lg border px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData}>
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => formatCurrency(Number(value))}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(Number(value))}
                  labelFormatter={(label) => `Month ${label}`}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#2563eb"
                  fill="#bfdbfe"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {scenarioData.payoffDate === null ? (
        <p className="text-xs text-amber-600">
          Payment is too low to pay off this debt.
        </p>
      ) : null}

      {scenarioSchedule.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Payment schedule</div>
            {scenarioSchedule.length > 6 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowFullSchedule((prev) => !prev)}
              >
                {showFullSchedule ? "Show less" : "Show full schedule"}
              </Button>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-4 gap-2 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Month</span>
              <span>Interest</span>
              <span>Principal</span>
              <span className="text-right">Balance</span>
            </div>
            <div className="max-h-[240px] overflow-y-auto">
              {visibleSchedule.map((item) => (
                <div
                  key={item.month}
                  className="grid grid-cols-4 gap-2 px-3 py-2 text-xs border-t"
                >
                  <span>{item.month}</span>
                  <span>{formatCurrency(item.interest)}</span>
                  <span>{formatCurrency(item.principal)}</span>
                  <span className="text-right">
                    {formatCurrency(item.balance)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No schedule available for this scenario.
        </p>
      )}
    </>
  );
}
