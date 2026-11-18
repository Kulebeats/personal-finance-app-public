import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
  useCurrentMonthRange,
  useReportsSpendingBreakdown,
} from "@/hooks/use-reports";
import { useFormatters } from "@/contexts/SettingsContext";
import { toMoneyNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { WidgetErrorState } from "./WidgetErrorState";

/**
 * Editorial-styled Top Merchants Widget
 *
 * Design: Dramatic leaderboard with rank badges and percentage bars
 * - Gold/Silver/Bronze treatment for top 3
 * - Animated percentage bars with gradient fills
 * - Fraunces display font for amounts
 * - Staggered entrance animations
 */

// Rank medal configurations
const RANK_STYLES = [
  {
    badge: "1",
    bgClass: "bg-gradient-to-br from-amber-400 to-amber-600",
    textClass: "text-amber-900",
    barClass: "from-amber-400 to-amber-500",
    label: "gold",
  },
  {
    badge: "2",
    bgClass: "bg-gradient-to-br from-slate-300 to-slate-400",
    textClass: "text-slate-700",
    barClass: "from-slate-400 to-slate-500",
    label: "silver",
  },
  {
    badge: "3",
    bgClass: "bg-gradient-to-br from-amber-600 to-amber-800",
    textClass: "text-amber-100",
    barClass: "from-amber-600 to-amber-700",
    label: "bronze",
  },
  {
    badge: "4",
    bgClass: "bg-muted",
    textClass: "text-muted-foreground",
    barClass: "from-muted-foreground/60 to-muted-foreground/40",
    label: "default",
  },
  {
    badge: "5",
    bgClass: "bg-muted",
    textClass: "text-muted-foreground",
    barClass: "from-muted-foreground/50 to-muted-foreground/30",
    label: "default",
  },
];

export default function TopMerchantsWidget() {
  const { from, to } = useCurrentMonthRange();
  const { data, isLoading, error, refetch } = useReportsSpendingBreakdown(
    {
      from,
      to,
      groupBy: "merchant",
      limit: 5,
    },
    { enabled: true }
  );
  const { formatCurrency } = useFormatters();

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load merchants"
        message="We couldn't fetch merchant spending."
        onRetry={() => refetch()}
        className="h-full"
      />
    );
  }

  const items = data?.items ?? [];
  const maxPercent = items.length > 0 ? items[0].percent : 0;

  return (
    <Card className="widget-editorial border-border/30 h-full flex flex-col overflow-hidden">
      {/* Art Deco corner flourish */}
      <div className="widget-flourish" />

      <CardHeader className="pb-3 pt-5 px-5 relative z-10">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
            Top Merchants
          </h3>
          <span className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            This month
          </span>
        </div>
        {/* Elegant separator */}
        <div className="mt-3 h-px bg-gradient-to-r from-[hsl(var(--widget-gold)/0.5)] via-[hsl(var(--border))] to-transparent" />
      </CardHeader>

      <CardContent className="flex-1 min-h-0 px-5 pb-5">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-xs font-body text-muted-foreground tracking-wide">
                Loading merchants...
              </span>
            </div>
          </div>
        ) : items.length ? (
          <div className="space-y-3">
            {items.map((item, index) => {
              const rankStyle = RANK_STYLES[index] || RANK_STYLES[4];
              const barWidth = maxPercent > 0 ? (item.percent / maxPercent) * 100 : 0;

              return (
                <div
                  key={item.id}
                  className={cn(
                    "group relative animate-count-up opacity-0",
                    `stagger-${index + 1}`
                  )}
                  style={{ animationFillMode: "forwards" }}
                >
                  <div
                    className={cn(
                      "relative flex items-center gap-3 p-3 rounded-xl transition-all duration-300",
                      "bg-muted/30 hover:bg-muted/50 border border-transparent hover:border-border/50"
                    )}
                  >
                    {/* Rank badge */}
                    <div
                      className={cn(
                        "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
                        "font-display font-bold text-sm shadow-sm",
                        rankStyle.bgClass,
                        rankStyle.textClass
                      )}
                    >
                      {rankStyle.badge}
                    </div>

                    {/* Merchant info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1.5">
                        <span className="font-body text-sm font-medium text-foreground truncate">
                          {item.label}
                        </span>
                        <span className="font-display text-sm font-semibold text-foreground flex-shrink-0">
                          {formatCurrency(toMoneyNumber(item.value))}
                        </span>
                      </div>

                      {/* Percentage bar */}
                      <div className="relative">
                        <div className="percentage-bar h-1.5">
                          <div
                            className={cn(
                              "fill bg-gradient-to-r",
                              rankStyle.barClass
                            )}
                            style={{
                              width: `${barWidth}%`,
                              transitionDelay: `${index * 0.1}s`,
                            }}
                          />
                        </div>
                        <span className="absolute right-0 -top-0.5 font-body text-[10px] text-muted-foreground">
                          {item.percent.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Total spending footer */}
            {data?.total && (
              <div className="pt-3 mt-3 border-t border-dashed border-[hsl(var(--widget-gold)/0.3)]">
                <div className="flex items-center justify-between">
                  <span className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                    Total Spending
                  </span>
                  <span className="font-display text-base font-semibold text-[hsl(var(--widget-expense))]">
                    {formatCurrency(toMoneyNumber(data.total))}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <span className="font-display text-3xl text-muted-foreground/50">
                ◇
              </span>
            </div>
            <p className="font-body text-sm text-muted-foreground mb-1">
              No merchant spend yet
            </p>
            <p className="font-body text-xs text-muted-foreground/70">
              Your top merchants will appear here
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
