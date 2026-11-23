import { throwIfResNotOk } from "@/lib/queryClient";
import { protectedFetch } from "@/lib/protected-fetch";
import { useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { NetWorthData } from "@shared/weekly-recap";
import type { MoneyDto } from "@shared/money";
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
import { formatCapturedWorth, formatPreviousWorth, snapshotCalendarDate } from "./formatCapturedWorth";

interface HistoricalRecap {
  weekStart: string;
  weekEnd: string;
  summary: {
    netWorth: NetWorthData;
    spending: number;
  };
}

interface HistoryResponse {
  history: HistoricalRecap[];
}

export default function WeeklyRecapHistory() {
  const { formatCurrency } = useFormatters();
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<{ key: string; client: QueryClient } | null>(null);

  const { data, isLoading, fetchStatus, error, refetch } = useQuery<HistoryResponse>({
    queryKey: ["weekly-recap-history"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 60_000,
    queryFn: async () => {
      const response = await protectedFetch("/api/weekly-recap/history", {
        credentials: "include",
      });
      await throwIfResNotOk(response);

      const result = await response.json();
      return result.data;
    },
  });

  if (isLoading || fetchStatus !== "idle") {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span>Checking current access to recap history…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="text-center py-12">
        <p className="text-destructive">Unable to refresh recap history.</p>
        <Button onClick={() => { void refetch(); }}>Retry</Button>
      </div>
    );
  }

  const history = data?.history || [];
  // Store only a key, bound to the session-owned client. A refetch always renders
  // the latest projection; replacing identity/role cannot retain the old object.
  const selectedWeek = selection?.client === queryClient
    ? history.find(recap => `${recap.weekStart}-${recap.weekEnd}` === selection.key) : undefined;
  const formatWorth = (value: number | null, worth: NetWorthData, money?: MoneyDto | null) => value === null
    ? "Historical net worth is unavailable" : formatCapturedWorth(money?.amount ?? value, money?.currency ?? worth.currency, formatCurrency);

  const formatWeekLabel = (start: string, end: string) => {
    const startDate = snapshotCalendarDate(start);
    const endDate = snapshotCalendarDate(end);
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
          const worth = recap.summary.netWorth;
          const previousWorth = formatPreviousWorth(worth, formatCurrency);
          const isPositive = worth.change !== null && worth.change >= 0;
          const isCurrent = index === 0;

          return (
            <Card
              key={`${recap.weekStart}-${recap.weekEnd}`}
              className={cn(
                "cursor-pointer transition-all hover:shadow-lg",
                isCurrent && "border-primary",
                selectedWeek === recap && "ring-2 ring-primary"
              )}
              onClick={() => setSelection({ key: `${recap.weekStart}-${recap.weekEnd}`, client: queryClient })}
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
                  {snapshotCalendarDate(recap.weekStart).getFullYear()}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Net Worth</p>
                  <p className="text-xl font-bold">
                    {formatWorth(worth.current, worth, worth.currentMoney)}
                  </p>
                  {worth.asOf && <p className="text-xs text-muted-foreground">Snapshot {worth.asOf}</p>}
                  {worth.change === null && previousWorth !== null && <p className="text-xs text-muted-foreground">
                    Previous snapshot {worth.previousAsOf}: {previousWorth}
                  </p>}
                  {worth.change === null ? <p className="text-xs text-muted-foreground">
                    {previousWorth === null ? "Previous period unavailable" : "Comparison unavailable"}
                  </p> : <div
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
                      {formatWorth(worth.change, worth, worth.changeMoney)}
                      {worth.changePercent !== null && ` (${worth.changePercent.toFixed(1)}%)`}
                    </span>
                  </div>}
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
                    {formatWorth(selectedWeek.summary.netWorth.current, selectedWeek.summary.netWorth, selectedWeek.summary.netWorth.currentMoney)}
                  </p>
                  {selectedWeek.summary.netWorth.change === null && formatPreviousWorth(selectedWeek.summary.netWorth, formatCurrency) !== null && <p>
                    Previous snapshot {selectedWeek.summary.netWorth.previousAsOf}: {formatPreviousWorth(selectedWeek.summary.netWorth, formatCurrency)}
                  </p>}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Change</p>
                  <p
                    className={cn(
                      "text-xl font-semibold",
                      selectedWeek.summary.netWorth.change !== null && selectedWeek.summary.netWorth.change >= 0
                        ? "text-emerald-500"
                        : "text-rose-500"
                    )}
                  >
                    {selectedWeek.summary.netWorth.change !== null && selectedWeek.summary.netWorth.change >= 0 ? "+" : ""}
                    {selectedWeek.summary.netWorth.change === null ? formatPreviousWorth(selectedWeek.summary.netWorth, formatCurrency) === null ? "Previous period unavailable" : "Comparison unavailable"
                      : formatWorth(selectedWeek.summary.netWorth.change, selectedWeek.summary.netWorth, selectedWeek.summary.netWorth.changeMoney)}
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
                onClick={() => setSelection(null)}
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
