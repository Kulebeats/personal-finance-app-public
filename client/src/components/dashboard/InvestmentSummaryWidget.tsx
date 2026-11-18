import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePortfolioSummary } from "@/hooks/useInvestments";
import { useFormatters } from "@/contexts/SettingsContext";
import { TrendingUp, TrendingDown, Briefcase } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetErrorState } from "./WidgetErrorState";

export default function InvestmentSummaryWidget() {
  const { data: summary, isLoading, error, refetch } = usePortfolioSummary();
  const { formatCurrency } = useFormatters();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Investment Portfolio
          </CardTitle>
          <Briefcase className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-[100px] mb-2" />
          <Skeleton className="h-4 w-[140px]" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load investments"
        message="We couldn't fetch your portfolio summary."
        onRetry={() => refetch()}
        className="h-full"
      />
    );
  }

  // Handle empty state gracefully
  if (!summary || summary.holdingsCount === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Investment Portfolio
          </CardTitle>
          <Briefcase className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            No active investments.
          </div>
          <Link
            href="/investments"
            className="text-xs text-primary hover:underline mt-2 inline-block"
          >
            Start Investing
          </Link>
        </CardContent>
      </Card>
    );
  }

  const isPositive = summary.totalGainLoss >= 0;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;
  const trendColor = isPositive ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400";

  return (
    <Link href="/investments">
      <Card className="hover:bg-accent/5 transition-colors cursor-pointer">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Investment Portfolio
          </CardTitle>
          <Briefcase className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(summary.totalValue)}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
            <span className={`${trendColor} flex items-center`}>
              <TrendIcon className="h-3 w-3 mr-1" />
              {isPositive ? "+" : ""}
              {formatCurrency(summary.totalGainLoss)} (
              {summary.totalGainLossPercent.toFixed(2)}%)
            </span>
            <span className="opacity-70">all time</span>
          </p>
          <div className="mt-3 text-xs text-muted-foreground">
            {summary.holdingsCount} active holdings
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
