/**
 * Statistics Cards for Merchant Detail View
 */

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { toMoneyNumber } from "@/lib/money";
import { useSettings } from "@/contexts/SettingsContext";

interface AnalyticsData {
  totalSpent?: string | number | null;
  transactionCount?: number | null;
  averageTransaction?: string | number | null;
}

interface QuickRangeData {
  totalSpent?: string | number | null;
}

interface MerchantStatsCardsProps {
  analytics: AnalyticsData | undefined;
  last30: QuickRangeData | undefined;
  last90: QuickRangeData | undefined;
  last365: QuickRangeData | undefined;
  onQuickRange: (days: number) => void;
}

export function MerchantStatsCards({
  analytics,
  last30,
  last90,
  last365,
  onQuickRange,
}: MerchantStatsCardsProps) {
  const { currency } = useSettings();

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Total spent</p>
          <p className="text-lg font-semibold">
            {formatCurrency(toMoneyNumber(analytics?.totalSpent ?? 0), currency)}
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Transactions</p>
          <p className="text-lg font-semibold">
            {analytics?.transactionCount || 0}
          </p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Average</p>
          <p className="text-lg font-semibold">
            {formatCurrency(
              toMoneyNumber(analytics?.averageTransaction ?? 0),
              currency
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">Quick ranges</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onQuickRange(30)}
            >
              Last 30 days
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onQuickRange(90)}
            >
              Last 90 days
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onQuickRange(365)}
            >
              Last 365 days
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded border p-3">
            <p className="text-xs text-muted-foreground">Last 30 days</p>
            <p className="text-base font-semibold">
              {formatCurrency(toMoneyNumber(last30?.totalSpent ?? 0), currency)}
            </p>
          </div>
          <div className="rounded border p-3">
            <p className="text-xs text-muted-foreground">Last 90 days</p>
            <p className="text-base font-semibold">
              {formatCurrency(toMoneyNumber(last90?.totalSpent ?? 0), currency)}
            </p>
          </div>
          <div className="rounded border p-3">
            <p className="text-xs text-muted-foreground">Last 365 days</p>
            <p className="text-base font-semibold">
              {formatCurrency(toMoneyNumber(last365?.totalSpent ?? 0), currency)}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
