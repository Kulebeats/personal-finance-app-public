import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, ArrowRight } from "lucide-react";
import { useFormatters } from "@/contexts/SettingsContext";
import { useUpcomingBills } from "@/hooks/useRecurring";
import { useLocation } from "wouter";
import { sumMoneyValues, toMoneyNumber } from "@/lib/money";
import { WidgetErrorState } from "./WidgetErrorState";

export default function RecurringExpensesWidget() {
  const { formatCurrency } = useFormatters();
  const [, setLocation] = useLocation();
  const {
    data: upcomingBills = [],
    isLoading,
    error,
    refetch,
  } = useUpcomingBills(7);

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load upcoming bills"
        message="We couldn't fetch your recurring schedule."
        onRetry={() => refetch()}
        className="h-full"
      />
    );
  }

  const totalUpcomingDecimal = sumMoneyValues(upcomingBills.map((bill) => bill.amount));
  const totalUpcoming = totalUpcomingDecimal.toNumber();

  return (
    <Card className="col-span-1 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold text-foreground">Upcoming Bills</CardTitle>
        <button
          onClick={() => setLocation("/recurring")}
          className="text-primary text-xs font-medium hover:underline flex items-center gap-1"
        >
            View All <ArrowRight className="w-3 h-3" />
        </button>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {isLoading && (
            <div className="text-xs text-muted-foreground">Loading...</div>
          )}
          {!isLoading && upcomingBills.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No upcoming bills
            </div>
          )}
          {!isLoading &&
            upcomingBills.map((bill) => {
              const dueDate = new Date(bill.nextDueDate);
              return (
                <button
                  key={bill.id}
                  type="button"
                  onClick={() => setLocation(`/recurring?ruleId=${bill.id}`)}
                  aria-label={`View recurring rule for ${bill.name}`}
                  className="w-full flex items-center justify-between group cursor-pointer text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                      {bill.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {bill.name}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" />{" "}
                        {dueDate.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatCurrency(toMoneyNumber(bill.amount))}
                  </div>
                </button>
              );
            })}
        </div>
        <div className="mt-6 pt-4 border-t border-border flex justify-between text-xs">
            <span className="text-muted-foreground">Total upcoming (7 days)</span>
            <span className="font-semibold text-foreground">
              {formatCurrency(totalUpcoming)}
            </span>
        </div>
      </CardContent>
    </Card>
  );
}
