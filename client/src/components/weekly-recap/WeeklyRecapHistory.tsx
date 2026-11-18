import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { useFormatters } from "@/contexts/SettingsContext";
import { cn } from "@/lib/utils";

interface HistoricalRecap {
  weekStart: string;
  weekEnd: string;
  summary: {
    netWorth: {
      current: number;
      change: number;
      changePercent: number;
    };
    spending: number;
  };
}

interface HistoryResponse {
  history: HistoricalRecap[];
}

export default function WeeklyRecapHistory() {
  const { formatCurrency } = useFormatters();
  const [selectedWeek, setSelectedWeek] = useState<HistoricalRecap | null>(null);

  const { data, isLoading, error } = useQuery<HistoryResponse>({
    queryKey: ["weekly-recap-history"],
    queryFn: async () => {
      const response = await fetch("/api/weekly-recap/history", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch history");
      const result = await response.json();
      return result.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">Failed to load history</p>
      </div>
    );
  }

  const history = data?.history || [];

  const formatWeekLabel = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    });
    return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Weekly Recap History</h2>
        <p className="text-muted-foreground">
          View your past weekly financial summaries
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {history.map((recap, index) => {
          const isPositive = recap.summary.netWorth.change >= 0;
          const isCurrent = index === 0;

          return (
            <Card
              key={`${recap.weekStart}-${recap.weekEnd}`}
              className={cn(
                "cursor-pointer transition-all hover:shadow-lg",
                isCurrent && "border-primary",
                selectedWeek === recap && "ring-2 ring-primary"
              )}
              onClick={() => setSelectedWeek(recap)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {formatWeekLabel(recap.weekStart, recap.weekEnd)}
                  </span>
                  {isCurrent && (
                    <span className="text-xs font-normal text-primary">
                      Current
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  {new Date(recap.weekStart).getFullYear()}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Net Worth</p>
                  <p className="text-xl font-bold">
                    {formatCurrency(recap.summary.netWorth.current)}
                  </p>
                  <div
                    className={cn(
                      "flex items-center gap-1 text-xs font-medium mt-1",
                      isPositive ? "text-emerald-500" : "text-rose-500"
                    )}
                  >
                    {isPositive ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    <span>
                      {isPositive ? "+" : ""}
                      {formatCurrency(recap.summary.netWorth.change)} (
                      {recap.summary.netWorth.changePercent.toFixed(1)}%)
                    </span>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">Spending</p>
                  <p className="text-lg font-semibold">
                    {formatCurrency(recap.summary.spending)}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {history.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No historical recaps available yet</p>
          <p className="text-sm mt-2">Check back next week!</p>
        </div>
      )}

      {selectedWeek && (
        <Card>
          <CardHeader>
            <CardTitle>Week Details</CardTitle>
            <CardDescription>
              {formatWeekLabel(selectedWeek.weekStart, selectedWeek.weekEnd)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Net Worth</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(selectedWeek.summary.netWorth.current)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Change</p>
                  <p
                    className={cn(
                      "text-xl font-semibold",
                      selectedWeek.summary.netWorth.change >= 0
                        ? "text-emerald-500"
                        : "text-rose-500"
                    )}
                  >
                    {selectedWeek.summary.netWorth.change >= 0 ? "+" : ""}
                    {formatCurrency(selectedWeek.summary.netWorth.change)}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Total Spending</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(selectedWeek.summary.spending)}
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setSelectedWeek(null)}
              >
                Close Details
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
