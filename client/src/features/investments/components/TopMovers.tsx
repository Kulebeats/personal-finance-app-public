import { Card } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Holding } from "@/hooks/useInvestments";

interface TopMoversProps {
  holdings: Holding[];
  displayCurrency: string;
  formatCurrency: (amount: number, currency: string) => string;
}

export function TopMovers({
  holdings,
  displayCurrency,
  formatCurrency,
}: TopMoversProps) {
  return (
    <Card className="p-5 shadow-sm border-border">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-emerald-600" /> Top Movers
      </h3>
      <div className="space-y-4">
        {holdings.length > 0 ? (
          holdings
            .filter((h) => Math.abs(h.gainLossPercent ?? 0) > 1)
            .sort(
              (a, b) =>
                Math.abs(b.gainLossPercent ?? 0) -
                Math.abs(a.gainLossPercent ?? 0)
            )
            .slice(0, 3)
            .map((h) => (
              <div key={h.id} className="flex justify-between items-center">
                <div>
                  <div className="font-bold">{h.security?.symbol ?? "N/A"}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(
                      Number(h.security?.currentPrice ?? "0"),
                      h.security?.currency ?? displayCurrency
                    )}
                  </div>
                </div>
                <div
                  className={cn(
                    "text-sm font-medium px-2 py-1 rounded",
                    (h.gainLossPercent ?? 0) > 0
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                  )}
                >
                  {(h.gainLossPercent ?? 0) > 0 ? "+" : ""}
                  {(h.gainLossPercent ?? 0).toFixed(1)}%
                </div>
              </div>
            ))
        ) : (
          <p className="text-muted-foreground text-sm">No significant movers</p>
        )}
      </div>
    </Card>
  );
}
